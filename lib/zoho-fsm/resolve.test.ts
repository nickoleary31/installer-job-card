import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveInboundServiceAppointment, type ZohoFsmRepo } from "./resolve.ts";
import type { InboundServiceAppointmentInput } from "./field-mapping.ts";

type FakeCustomerAccount = { id: string; companyId: string; zohoCompanyId: string; name: string };
type FakeSite = {
  id: string;
  companyId: string;
  customerAccountId: string;
  zohoSiteCode: string;
  name: string;
  fullAddress: string | null;
  siteContactName: string | null;
  contactNumber: string | null;
  contactEmail: string | null;
  endCustomerName: string | null;
};
type FakeProject = { id: string; companyId: string; customerId: string; projectName: string; customerName: string; location: string };
type FakeLink = {
  id: string;
  projectId: string;
  companyId: string;
  zohoWorkOrderId: string;
  zohoServiceAppointmentId: string;
  zohoWorkOrderNumber: string | null;
  zohoServiceAppointmentNumber: string | null;
  zohoCompanyId: string;
  rawSnapshot: unknown;
};
type FakeInboundEvent = {
  outcome: string;
  detail: string | null;
  projectId: string | null;
  zohoServiceAppointmentId: string | null;
};

function createFakeRepo(seed?: { companyMappings?: Record<string, string> }) {
  let nextId = 1;
  const id = (prefix: string) => `${prefix}-${nextId++}`;

  const state = {
    companyMappings: new Map<string, string>(Object.entries(seed?.companyMappings ?? {})),
    customerAccounts: [] as FakeCustomerAccount[],
    sites: [] as FakeSite[],
    projects: [] as FakeProject[],
    links: [] as FakeLink[],
    inboundEvents: [] as FakeInboundEvent[],
  };

  const repo: ZohoFsmRepo = {
    async findActiveCompanyMapping(zohoValue) {
      const companyId = state.companyMappings.get(zohoValue);
      return companyId ? { companyId } : null;
    },
    async findExistingLink(zohoServiceAppointmentId) {
      const link = state.links.find((l) => l.zohoServiceAppointmentId === zohoServiceAppointmentId);
      if (!link) return null;
      const project = state.projects.find((p) => p.id === link.projectId);
      const site = project ? state.sites.find((s) => s.id === project.customerId) : undefined;
      return {
        id: link.id,
        projectId: link.projectId,
        companyId: link.companyId,
        zohoSiteCode: site?.zohoSiteCode ?? null,
      };
    },
    async refreshLinkSnapshot(linkId, args) {
      const link = state.links.find((l) => l.id === linkId);
      if (!link) throw new Error("link not found");
      link.rawSnapshot = args.rawSnapshot;
      link.zohoWorkOrderNumber = args.zohoWorkOrderNumber;
      link.zohoServiceAppointmentNumber = args.zohoServiceAppointmentNumber;
    },
    async refreshSiteAndProjectDisplayFields(projectId, args) {
      // Mirrors repo-supabase.ts's own blank-safety: whitespace-only candidates count as absent
      // regardless of whether the caller already trimmed them.
      const nonBlank = (value: string | null): string | null => {
        if (typeof value !== "string") return null;
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
      };
      const project = state.projects.find((p) => p.id === projectId);
      if (!project) return;
      const site = state.sites.find((s) => s.id === project.customerId);
      if (site) {
        const fullAddress = nonBlank(args.fullAddress);
        const siteContactName = nonBlank(args.siteContactName);
        const contactNumber = nonBlank(args.contactNumber);
        const contactEmail = nonBlank(args.contactEmail);
        if (fullAddress) site.fullAddress = fullAddress;
        if (siteContactName) site.siteContactName = siteContactName;
        if (contactNumber) site.contactNumber = contactNumber;
        if (contactEmail) site.contactEmail = contactEmail;
      }
      const location = nonBlank(args.location);
      if (location) project.location = location;
    },
    async findCustomerAccountByZohoCompanyId(companyId, zohoCompanyId) {
      const account = state.customerAccounts.find(
        (a) => a.companyId === companyId && a.zohoCompanyId === zohoCompanyId,
      );
      return account ? { id: account.id } : null;
    },
    async createCustomerAccount(args) {
      const account: FakeCustomerAccount = { id: id("account"), ...args };
      state.customerAccounts.push(account);
      return { id: account.id };
    },
    async findSiteByCode(companyId, zohoSiteCode) {
      const site = state.sites.find((s) => s.companyId === companyId && s.zohoSiteCode === zohoSiteCode);
      return site ? { id: site.id } : null;
    },
    async createSite(args) {
      const site: FakeSite = { id: id("site"), ...args };
      state.sites.push(site);
      return { id: site.id };
    },
    async createProject(args) {
      const project: FakeProject = { id: id("project"), ...args };
      state.projects.push(project);
      return { id: project.id };
    },
    async createLink(args) {
      const link: FakeLink = { id: id("link"), ...args };
      state.links.push(link);
      return { id: link.id };
    },
    async logInboundEvent(args) {
      state.inboundEvents.push({
        outcome: args.outcome,
        detail: args.detail,
        projectId: args.projectId,
        zohoServiceAppointmentId: args.zohoServiceAppointmentId,
      });
    },
  };

  return { repo, state };
}

function baseInput(overrides: Partial<InboundServiceAppointmentInput> = {}): InboundServiceAppointmentInput {
  return {
    zohoWorkOrderId: "wo-1",
    zohoServiceAppointmentId: "sa-1",
    zohoWorkOrderNumber: "WO21",
    zohoServiceAppointmentNumber: "AP-2",
    installerSheetzCompanyValue: "Blaxtair",
    zohoSiteCode: "GM-VOLTOVA-ROANOKE",
    zohoCompanyId: "zc-shoppas",
    dealerName: "Shoppas",
    siteAddressName: "GM - Voltova Roanoke",
    siteAddressLine: "1 Plant Rd, Roanoke, VA",
    siteContactName: "Jane Doe",
    siteContactPhone: "555-1234",
    siteContactEmail: "jane@example.com",
    summary: "Install 3 systems",
    raw: { workOrder: {} as never, serviceAppointment: {} as never },
    ...overrides,
  };
}

describe("resolveInboundServiceAppointment", () => {
  it("ignores a blank Installer Sheetz Company as not opted in (no project, no error)", async () => {
    const { repo, state } = createFakeRepo();
    const result = await resolveInboundServiceAppointment(repo, baseInput({ installerSheetzCompanyValue: null }));
    assert.equal(result.outcome, "ignored_not_opted_in");
    assert.equal(result.projectId, null);
    assert.equal(state.projects.length, 0);
    assert.equal(state.inboundEvents.at(-1)?.outcome, "ignored_not_opted_in");
  });

  it("produces an actionable error for a nonblank but unmapped Company value, and creates no project", async () => {
    const { repo, state } = createFakeRepo(); // no mappings seeded
    const result = await resolveInboundServiceAppointment(repo, baseInput({ installerSheetzCompanyValue: "Unknown Co" }));
    assert.equal(result.outcome, "error_company_unmapped");
    assert.match(result.detail || "", /Unknown Co/);
    assert.equal(result.projectId, null);
    assert.equal(state.projects.length, 0);
    assert.equal(state.customerAccounts.length, 0);
  });

  it("produces an actionable error for a recognized Company with a blank Site Code, and creates no project", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    const result = await resolveInboundServiceAppointment(repo, baseInput({ zohoSiteCode: null }));
    assert.equal(result.outcome, "error_site_code_missing");
    assert.equal(result.projectId, null);
    assert.equal(state.projects.length, 0);
    assert.equal(state.sites.length, 0);
  });

  it("reuses an existing Site when the Site Code already matches one, rather than creating a new one", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    // First event creates the site.
    const first = await resolveInboundServiceAppointment(repo, baseInput({ zohoServiceAppointmentId: "sa-1" }));
    assert.equal(first.outcome, "created");
    assert.equal(state.sites.length, 1);
    const siteId = state.sites[0].id;

    // A different SA at the same known site (e.g. a repeat visit) reuses it.
    const second = await resolveInboundServiceAppointment(
      repo,
      baseInput({ zohoServiceAppointmentId: "sa-2", zohoWorkOrderId: "wo-2" }),
    );
    assert.equal(second.outcome, "created");
    assert.equal(state.sites.length, 1, "must not create a second Site for the same code");
    assert.equal(state.projects.find((p) => p.id === second.projectId)?.customerId, siteId);
  });

  it("creates exactly one new Site under the correct customer_account for a new Site Code", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    const result = await resolveInboundServiceAppointment(repo, baseInput());
    assert.equal(result.outcome, "created");
    assert.equal(state.sites.length, 1);
    assert.equal(state.customerAccounts.length, 1);
    assert.equal(state.sites[0].zohoSiteCode, "GM-VOLTOVA-ROANOKE");
    assert.equal(state.sites[0].customerAccountId, state.customerAccounts[0].id);
    assert.equal(state.sites[0].companyId, "company-blaxtair");
  });

  it("creates a separate IS project for each Service Appointment under the SAME Work Order (1 WO -> many SAs -> many projects)", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    const sharedWorkOrderId = "wo-12345";

    const first = await resolveInboundServiceAppointment(
      repo,
      baseInput({ zohoServiceAppointmentId: "sa-1001", zohoWorkOrderId: sharedWorkOrderId }),
    );
    const second = await resolveInboundServiceAppointment(
      repo,
      baseInput({ zohoServiceAppointmentId: "sa-1002", zohoWorkOrderId: sharedWorkOrderId }),
    );
    const third = await resolveInboundServiceAppointment(
      repo,
      baseInput({ zohoServiceAppointmentId: "sa-1003", zohoWorkOrderId: sharedWorkOrderId }),
    );

    assert.equal(first.outcome, "created");
    assert.equal(second.outcome, "created");
    assert.equal(third.outcome, "created");
    // Three distinct projects, none reused, even though zoho_work_order_id is identical on all three.
    assert.equal(new Set([first.projectId, second.projectId, third.projectId]).size, 3);
    assert.equal(state.projects.length, 3);
    assert.equal(state.links.length, 3);
    assert.ok(state.links.every((link) => link.zohoWorkOrderId === sharedWorkOrderId));
    // The site (same physical location across all three dispatches) and the customer_account
    // are correctly shared/reused — only the project/link is per-SA.
    assert.equal(state.sites.length, 1);
    assert.equal(state.customerAccounts.length, 1);
  });

  it("reuses the same customer_account across multiple Sites via the stable Zoho Company id", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    await resolveInboundServiceAppointment(
      repo,
      baseInput({ zohoServiceAppointmentId: "sa-roanoke", zohoWorkOrderId: "wo-roanoke", zohoSiteCode: "GM-VOLTOVA-ROANOKE" }),
    );
    await resolveInboundServiceAppointment(
      repo,
      baseInput({ zohoServiceAppointmentId: "sa-detroit", zohoWorkOrderId: "wo-detroit", zohoSiteCode: "GM-DETROIT" }),
    );

    assert.equal(state.customerAccounts.length, 1, "Shoppas should only be created once");
    assert.equal(state.sites.length, 2);
    assert.equal(state.sites[0].customerAccountId, state.sites[1].customerAccountId);
  });

  it("does not duplicate project/Site/customer_account on repeated delivery for the same SA", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    const first = await resolveInboundServiceAppointment(repo, baseInput());
    const second = await resolveInboundServiceAppointment(repo, baseInput());

    assert.equal(first.outcome, "created");
    assert.equal(second.outcome, "reused_existing");
    assert.equal(second.projectId, first.projectId);
    assert.equal(state.projects.length, 1);
    assert.equal(state.sites.length, 1);
    assert.equal(state.customerAccounts.length, 1);
    assert.equal(state.links.length, 1);
  });

  it("protects true identity/project-owned fields on a matching redelivery, while Zoho-owned descriptive fields refresh", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    const firstRaw = { workOrder: { id: "wo-1", Summary: "first delivery" } as never, serviceAppointment: {} as never };
    await resolveInboundServiceAppointment(repo, baseInput({ raw: firstRaw }));

    // Simulate an admin renaming project/customer_account identity-ish records after intake —
    // these are never Zoho-derived and must never be touched by a redelivery.
    state.projects[0].projectName = "Renamed by admin";
    state.customerAccounts[0].name = "Renamed by admin";

    // Zoho redelivers the same SA (same Company/Site Code — identity unchanged) with
    // different-looking contact info and an updated snapshot.
    const secondRaw = { workOrder: { id: "wo-1", Summary: "second delivery" } as never, serviceAppointment: {} as never };
    await resolveInboundServiceAppointment(
      repo,
      baseInput({ siteContactName: "Different Name From Zoho", raw: secondRaw }),
    );

    // True identity/project-owned fields: untouched.
    assert.equal(state.projects[0].projectName, "Renamed by admin");
    assert.equal(state.customerAccounts[0].name, "Renamed by admin");
    assert.equal(state.projects.length, 1);
    assert.equal(state.sites.length, 1);
    assert.equal(state.customerAccounts.length, 1);
    // Zoho-owned descriptive field: refreshes, per the approved metadata source-of-truth policy.
    assert.equal(state.sites[0].siteContactName, "Different Name From Zoho");
    // The link's own snapshot/diagnostic fields are allowed to refresh on redelivery.
    assert.deepEqual(state.links[0].rawSnapshot, secondRaw);
  });

  it("(A) non-destructively refreshes Zoho-owned descriptive fields on a matching repeat delivery with changed address/contact", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    const first = await resolveInboundServiceAppointment(repo, baseInput());
    assert.equal(first.outcome, "created");
    const originalProjectId = first.projectId;
    const originalSiteId = state.sites[0].id;
    const originalCustomerAccountId = state.customerAccounts[0].id;

    const second = await resolveInboundServiceAppointment(
      repo,
      baseInput({
        siteAddressLine: "5811 Priest Rd\nAcworth, GA 30102",
        siteContactName: "New Contact",
        siteContactPhone: "555-9999",
        siteContactEmail: "new@example.com",
      }),
    );

    assert.equal(second.outcome, "reused_existing");
    assert.equal(second.projectId, originalProjectId);
    // Identity unchanged: same site/customer_account/project rows, none duplicated.
    assert.equal(state.sites.length, 1);
    assert.equal(state.sites[0].id, originalSiteId);
    assert.equal(state.customerAccounts.length, 1);
    assert.equal(state.customerAccounts[0].id, originalCustomerAccountId);
    assert.equal(state.projects.length, 1);
    // Descriptive fields refreshed from the new delivery.
    assert.equal(state.sites[0].fullAddress, "5811 Priest Rd\nAcworth, GA 30102");
    assert.equal(state.sites[0].siteContactName, "New Contact");
    assert.equal(state.sites[0].contactNumber, "555-9999");
    assert.equal(state.sites[0].contactEmail, "new@example.com");
    assert.equal(state.projects[0].location, "5811 Priest Rd\nAcworth, GA 30102");
  });

  it("(B) does not erase existing descriptive values when the incoming Zoho value is null/blank", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    await resolveInboundServiceAppointment(repo, baseInput());
    assert.equal(state.sites[0].fullAddress, "1 Plant Rd, Roanoke, VA");
    assert.equal(state.sites[0].contactEmail, "jane@example.com");

    await resolveInboundServiceAppointment(
      repo,
      baseInput({ siteAddressLine: null, siteContactName: null, siteContactPhone: null, siteContactEmail: null }),
    );

    assert.equal(state.sites[0].fullAddress, "1 Plant Rd, Roanoke, VA");
    assert.equal(state.sites[0].siteContactName, "Jane Doe");
    assert.equal(state.sites[0].contactNumber, "555-1234");
    assert.equal(state.sites[0].contactEmail, "jane@example.com");
    assert.equal(state.projects[0].location, "1 Plant Rd, Roanoke, VA");
  });

  it("(B-extra) treats whitespace-only incoming values as blank, independent of upstream trimming", async () => {
    // field-mapping.ts always trims before this point, so inject whitespace-only strings
    // directly here to prove the refresh boundary itself is blank-safe, not just its one
    // current caller.
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    await resolveInboundServiceAppointment(repo, baseInput());
    const originalAddress = state.sites[0].fullAddress;
    const originalContactName = state.sites[0].siteContactName;
    const originalLocation = state.projects[0].location;

    await resolveInboundServiceAppointment(
      repo,
      baseInput({ siteAddressLine: "   ", siteContactName: "\t", siteContactPhone: "  ", siteContactEmail: " " }),
    );

    assert.equal(state.sites[0].fullAddress, originalAddress);
    assert.equal(state.sites[0].siteContactName, originalContactName);
    assert.equal(state.projects[0].location, originalLocation);
  });

  it("(C) withholds descriptive refresh and logs identity_mismatch_on_reuse when the incoming Site Code no longer matches", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    const first = await resolveInboundServiceAppointment(repo, baseInput());
    const originalProjectId = first.projectId;
    const originalAddress = state.sites[0].fullAddress;

    const second = await resolveInboundServiceAppointment(
      repo,
      baseInput({ zohoSiteCode: "SOME-OTHER-CODE", siteAddressLine: "999 Different St, Nowhere, XX 00000" }),
    );

    assert.equal(second.outcome, "identity_mismatch_on_reuse");
    assert.equal(second.projectId, originalProjectId);
    assert.match(second.detail || "", /Identity mismatch/);
    assert.match(second.detail || "", /SOME-OTHER-CODE/);
    // Identity and descriptive fields both unchanged — the mismatched payload is not applied.
    assert.equal(state.sites.length, 1);
    assert.equal(state.sites[0].fullAddress, originalAddress);
    assert.equal(state.projects.length, 1);
    assert.equal(state.projects[0].location, originalAddress);
    assert.equal(state.inboundEvents.at(-1)?.outcome, "identity_mismatch_on_reuse");
  });

  it("(D) withholds descriptive refresh and logs identity_mismatch_on_reuse when the incoming Company differs or is blank/unmapped", async () => {
    const { repo, state } = createFakeRepo({
      companyMappings: { Blaxtair: "company-blaxtair", Litum: "company-litum" },
    });
    const first = await resolveInboundServiceAppointment(repo, baseInput());
    const originalProjectId = first.projectId;

    const differentCompany = await resolveInboundServiceAppointment(
      repo,
      baseInput({ installerSheetzCompanyValue: "Litum" }),
    );
    assert.equal(differentCompany.outcome, "identity_mismatch_on_reuse");
    assert.equal(differentCompany.projectId, originalProjectId);

    const blankCompany = await resolveInboundServiceAppointment(repo, baseInput({ installerSheetzCompanyValue: null }));
    assert.equal(blankCompany.outcome, "identity_mismatch_on_reuse");
    assert.equal(blankCompany.projectId, originalProjectId);

    const unmappedCompany = await resolveInboundServiceAppointment(
      repo,
      baseInput({ installerSheetzCompanyValue: "Totally Unknown Co" }),
    );
    assert.equal(unmappedCompany.outcome, "identity_mismatch_on_reuse");
    assert.equal(unmappedCompany.projectId, originalProjectId);

    assert.equal(state.projects.length, 1, "no new project ever created across all three mismatch attempts");
  });

  it("(E) populates contact_email on creation and safely refreshes it on repeat delivery, without erasing it on a blank input", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    await resolveInboundServiceAppointment(repo, baseInput({ siteContactEmail: "first@example.com" }));
    assert.equal(state.sites[0].contactEmail, "first@example.com");

    await resolveInboundServiceAppointment(repo, baseInput({ siteContactEmail: "second@example.com" }));
    assert.equal(state.sites[0].contactEmail, "second@example.com");

    await resolveInboundServiceAppointment(repo, baseInput({ siteContactEmail: null }));
    assert.equal(
      state.sites[0].contactEmail,
      "second@example.com",
      "blank incoming email must not erase the existing one",
    );
  });

  it("produces an actionable error when the Work Order has no Zoho Company reference, without creating a throwaway customer_account", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    const result = await resolveInboundServiceAppointment(repo, baseInput({ zohoCompanyId: null }));
    assert.equal(result.outcome, "error_missing_zoho_company_id");
    assert.equal(result.projectId, null);
    assert.equal(state.customerAccounts.length, 0);
    assert.equal(state.projects.length, 0);
  });
});
