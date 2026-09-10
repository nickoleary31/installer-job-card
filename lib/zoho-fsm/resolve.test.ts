import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { resolveInboundServiceAppointment, type ZohoFsmRepo } from "./resolve.ts";
import type { InboundServiceAppointmentInput } from "./field-mapping.ts";

type FakeCustomerAccount = { id: string; companyId: string; zohoCompanyId: string; name: string };
type FakeSite = {
  id: string;
  companyId: string;
  customerAccountId: string;
  zohoServiceAddressId: string;
  name: string;
  fullAddress: string | null;
  siteContactName: string | null;
  contactNumber: string | null;
  contactEmail: string | null;
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
        siteId: project?.customerId ?? null,
        companyId: link.companyId,
        zohoCompanyId: link.zohoCompanyId,
        zohoServiceAddressId: site?.zohoServiceAddressId ?? null,
      };
    },
    async refreshLinkSnapshot(linkId, args) {
      const link = state.links.find((l) => l.id === linkId);
      if (!link) throw new Error("link not found");
      link.rawSnapshot = args.rawSnapshot;
      link.zohoWorkOrderNumber = args.zohoWorkOrderNumber;
      link.zohoServiceAppointmentNumber = args.zohoServiceAppointmentNumber;
    },
    async refreshSiteDisplayFields(siteId, args) {
      // Mirrors repo-supabase.ts's own blank-safety for optional fields; siteName is
      // unconditional, matching repo-supabase.ts's own handling of derived display metadata.
      const nonBlank = (value: string | null): string | null => {
        if (typeof value !== "string") return null;
        const trimmed = value.trim();
        return trimmed ? trimmed : null;
      };
      const site = state.sites.find((s) => s.id === siteId);
      if (!site) return;
      site.name = args.siteName;
      const fullAddress = nonBlank(args.fullAddress);
      const siteContactName = nonBlank(args.siteContactName);
      const contactNumber = nonBlank(args.contactNumber);
      const contactEmail = nonBlank(args.contactEmail);
      if (fullAddress) site.fullAddress = fullAddress;
      if (siteContactName) site.siteContactName = siteContactName;
      if (contactNumber) site.contactNumber = contactNumber;
      if (contactEmail) site.contactEmail = contactEmail;
    },
    async refreshProjectDisplayFields(projectId, args) {
      const project = state.projects.find((p) => p.id === projectId);
      if (!project) return;
      // project_name and the denormalized projects.customer_name are unconditional — both are
      // derived Zoho display metadata, mirroring repo-supabase.ts.
      project.projectName = args.projectName;
      project.customerName = args.customerName;
      const location = typeof args.location === "string" ? args.location.trim() : "";
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
    async findSiteByServiceAddress(customerAccountId, zohoServiceAddressId) {
      const site = state.sites.find(
        (s) => s.customerAccountId === customerAccountId && s.zohoServiceAddressId === zohoServiceAddressId,
      );
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
    zohoServiceAddressId: "46814000000400012",
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

  it("produces an actionable error for a recognized Company with no Service_Address.id, and creates no project (no fallback to address-text matching)", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    const result = await resolveInboundServiceAppointment(repo, baseInput({ zohoServiceAddressId: null }));
    assert.equal(result.outcome, "error_missing_service_address_id");
    assert.equal(result.projectId, null);
    assert.equal(state.projects.length, 0);
    assert.equal(state.sites.length, 0);
  });

  it("reuses an existing Site when the Service_Address.id already matches one under the same Customer Account, rather than creating a new one", async () => {
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
    assert.equal(state.sites.length, 1, "must not create a second Site for the same Service_Address.id");
    assert.equal(state.projects.find((p) => p.id === second.projectId)?.customerId, siteId);
  });

  it("(new-SA-1) a brand-new SA resolving to an existing Site with a changed Service_Address_Name refreshes that Site's name, reuses the same Site row, and the new Project uses the current Site name", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    const first = await resolveInboundServiceAppointment(
      repo,
      baseInput({ zohoServiceAppointmentId: "sa-1", zohoWorkOrderId: "wo-1", siteAddressName: "Evergreen AHD Demo" }),
    );
    assert.equal(first.outcome, "created");
    assert.equal(state.sites.length, 1);
    const originalSiteId = state.sites[0].id;
    assert.equal(state.sites[0].name, "Evergreen AHD Demo");

    // The office corrects the Address Name in Zoho, then a completely new SA arrives for the
    // same Customer Account + Service_Address.id.
    const second = await resolveInboundServiceAppointment(
      repo,
      baseInput({
        zohoServiceAppointmentId: "sa-2",
        zohoWorkOrderId: "wo-2",
        siteAddressName: "Evergreen Acworth",
        summary: "Install Two AHD systems",
        zohoServiceAppointmentNumber: "AP-9",
      }),
    );

    assert.equal(second.outcome, "created", "still a new project for the new SA, not a reused_existing redelivery");
    assert.notEqual(second.projectId, first.projectId, "(new-SA-4) a distinct new Project/SA link is created");
    assert.equal(state.sites.length, 1, "same Site id reused — no second Site row created");
    assert.equal(state.sites[0].id, originalSiteId);
    assert.equal(state.sites[0].name, "Evergreen Acworth", "Site name refreshed from the current Service_Address_Name");
    assert.equal(state.projects.length, 2);
    const secondProject = state.projects.find((p) => p.id === second.projectId);
    assert.equal(secondProject?.customerName, "Evergreen Acworth", "new Project uses the CURRENT Site name");
    assert.equal(secondProject?.projectName, "Evergreen Acworth — Install Two AHD systems — AP-9");
    // The first project, created under the old name, is untouched — renaming the Site does not
    // retroactively rewrite an unrelated existing project's name.
    assert.equal(state.projects.find((p) => p.id === first.projectId)?.projectName, "Evergreen AHD Demo — Install 3 systems — AP-2");
  });

  it("(new-SA-2) a brand-new SA resolving to an existing Site with changed address/contact/phone/email refreshes those descriptive fields on the Site", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    await resolveInboundServiceAppointment(
      repo,
      baseInput({
        zohoServiceAppointmentId: "sa-1",
        zohoWorkOrderId: "wo-1",
        siteAddressLine: "1 Plant Rd, Roanoke, VA",
        siteContactName: "Jane Doe",
        siteContactPhone: "555-1234",
        siteContactEmail: "jane@example.com",
      }),
    );
    assert.equal(state.sites.length, 1);
    const originalSiteId = state.sites[0].id;

    await resolveInboundServiceAppointment(
      repo,
      baseInput({
        zohoServiceAppointmentId: "sa-2",
        zohoWorkOrderId: "wo-2",
        siteAddressLine: "5811 Priest Rd\nAcworth, GA 30102",
        siteContactName: "New Contact",
        siteContactPhone: "555-9999",
        siteContactEmail: "new@example.com",
      }),
    );

    assert.equal(state.sites.length, 1);
    assert.equal(state.sites[0].id, originalSiteId);
    assert.equal(state.sites[0].fullAddress, "5811 Priest Rd\nAcworth, GA 30102");
    assert.equal(state.sites[0].siteContactName, "New Contact");
    assert.equal(state.sites[0].contactNumber, "555-9999");
    assert.equal(state.sites[0].contactEmail, "new@example.com");
  });

  it("(new-SA-3) blank optional metadata on a new SA resolving to an existing Site does not erase the Site's existing useful values", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    await resolveInboundServiceAppointment(
      repo,
      baseInput({
        zohoServiceAppointmentId: "sa-1",
        zohoWorkOrderId: "wo-1",
        siteAddressLine: "1 Plant Rd, Roanoke, VA",
        siteContactName: "Jane Doe",
        siteContactPhone: "555-1234",
        siteContactEmail: "jane@example.com",
      }),
    );

    await resolveInboundServiceAppointment(
      repo,
      baseInput({
        zohoServiceAppointmentId: "sa-2",
        zohoWorkOrderId: "wo-2",
        siteAddressLine: null,
        siteContactName: null,
        siteContactPhone: null,
        siteContactEmail: null,
      }),
    );

    assert.equal(state.sites.length, 1);
    assert.equal(state.sites[0].fullAddress, "1 Plant Rd, Roanoke, VA");
    assert.equal(state.sites[0].siteContactName, "Jane Doe");
    assert.equal(state.sites[0].contactNumber, "555-1234");
    assert.equal(state.sites[0].contactEmail, "jane@example.com");
  });

  it("names a newly created project '<Site> — <Work Order Summary> — <SA Number>'", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    await resolveInboundServiceAppointment(
      repo,
      baseInput({
        siteAddressName: "Evergreen Acworth",
        summary: "Blaxtair 2 camera install - 3 systems",
        zohoServiceAppointmentNumber: "AP-4",
      }),
    );
    assert.equal(state.projects[0].projectName, "Evergreen Acworth — Blaxtair 2 camera install - 3 systems — AP-4");
    // Never the Customer Account (Shoppas) or OE/Company name in the project name.
    assert.doesNotMatch(state.projects[0].projectName, /Shoppas/);
  });

  it("omits a blank Work Order Summary from the project name without a stray separator (defensive fallback)", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    await resolveInboundServiceAppointment(
      repo,
      baseInput({ siteAddressName: "Evergreen Acworth", summary: null, zohoServiceAppointmentNumber: "AP-4" }),
    );
    assert.equal(state.projects[0].projectName, "Evergreen Acworth — AP-4");
  });

  it("uses the SA number, never a synthetic (2)/(3) suffix, to keep names unique across repeated visits with a similar Summary", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    await resolveInboundServiceAppointment(
      repo,
      baseInput({
        zohoServiceAppointmentId: "sa-1001",
        zohoWorkOrderId: "wo-1001",
        siteAddressName: "Evergreen Acworth",
        summary: "Install VAC4",
        zohoServiceAppointmentNumber: "AP-4",
      }),
    );
    await resolveInboundServiceAppointment(
      repo,
      baseInput({
        zohoServiceAppointmentId: "sa-1002",
        zohoWorkOrderId: "wo-1002",
        siteAddressName: "Evergreen Acworth",
        summary: "Install VAC4",
        zohoServiceAppointmentNumber: "AP-5",
      }),
    );
    assert.equal(state.projects.length, 2);
    assert.equal(state.projects[0].projectName, "Evergreen Acworth — Install VAC4 — AP-4");
    assert.equal(state.projects[1].projectName, "Evergreen Acworth — Install VAC4 — AP-5");
    assert.doesNotMatch(state.projects[1].projectName, /\(2\)/);
  });

  it("creates exactly one new Site under the correct customer_account for a new Service_Address.id", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    const result = await resolveInboundServiceAppointment(repo, baseInput());
    assert.equal(result.outcome, "created");
    assert.equal(state.sites.length, 1);
    assert.equal(state.customerAccounts.length, 1);
    assert.equal(state.sites[0].zohoServiceAddressId, "46814000000400012");
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
      baseInput({ zohoServiceAppointmentId: "sa-roanoke", zohoWorkOrderId: "wo-roanoke", zohoServiceAddressId: "addr-roanoke" }),
    );
    await resolveInboundServiceAppointment(
      repo,
      baseInput({ zohoServiceAppointmentId: "sa-detroit", zohoWorkOrderId: "wo-detroit", zohoServiceAddressId: "addr-detroit" }),
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

  it("two different Customer Accounts can have a Site with the identical display name — customer_name is not identity", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    await resolveInboundServiceAppointment(
      repo,
      baseInput({
        zohoServiceAppointmentId: "sa-shoppas",
        zohoWorkOrderId: "wo-shoppas",
        zohoCompanyId: "zc-shoppas",
        dealerName: "Shoppas",
        siteAddressName: "Main Warehouse",
        zohoServiceAddressId: "addr-AAA",
      }),
    );
    await resolveInboundServiceAppointment(
      repo,
      baseInput({
        zohoServiceAppointmentId: "sa-evergreen",
        zohoWorkOrderId: "wo-evergreen",
        zohoCompanyId: "zc-evergreen",
        dealerName: "Evergreen",
        siteAddressName: "Main Warehouse",
        zohoServiceAddressId: "addr-BBB",
      }),
    );

    assert.equal(state.customerAccounts.length, 2);
    assert.equal(state.sites.length, 2);
    assert.equal(state.sites[0].name, "Main Warehouse");
    assert.equal(state.sites[1].name, "Main Warehouse");
    assert.notEqual(state.sites[0].customerAccountId, state.sites[1].customerAccountId);
  });

  it("two different Customer Accounts can coincidentally share a Service_Address.id value without colliding — identity is the composite pair", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    await resolveInboundServiceAppointment(
      repo,
      baseInput({
        zohoServiceAppointmentId: "sa-shoppas",
        zohoWorkOrderId: "wo-shoppas",
        zohoCompanyId: "zc-shoppas",
        dealerName: "Shoppas",
        zohoServiceAddressId: "addr-shared",
      }),
    );
    await resolveInboundServiceAppointment(
      repo,
      baseInput({
        zohoServiceAppointmentId: "sa-evergreen",
        zohoWorkOrderId: "wo-evergreen",
        zohoCompanyId: "zc-evergreen",
        dealerName: "Evergreen",
        zohoServiceAddressId: "addr-shared",
      }),
    );

    assert.equal(state.customerAccounts.length, 2);
    assert.equal(state.sites.length, 2, "distinct Sites — the composite identity differs even though the address id string matches");
  });

  it("protects true identity/project-owned fields on a matching redelivery, while Zoho-owned descriptive fields refresh", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    const firstRaw = { workOrder: { id: "wo-1", Summary: "first delivery" } as never, serviceAppointment: {} as never };
    await resolveInboundServiceAppointment(repo, baseInput({ raw: firstRaw }));

    // Simulate an admin renaming customer_account identity-ish records after intake —
    // these are never Zoho-derived and must never be touched by a redelivery.
    state.customerAccounts[0].name = "Renamed by admin";

    // Zoho redelivers the same SA (same Company/dealer/Service_Address.id — identity unchanged)
    // with different-looking contact info and an updated snapshot.
    const secondRaw = { workOrder: { id: "wo-1", Summary: "second delivery" } as never, serviceAppointment: {} as never };
    await resolveInboundServiceAppointment(
      repo,
      baseInput({ siteContactName: "Different Name From Zoho", raw: secondRaw }),
    );

    // True identity-owned fields: untouched.
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

  it("Address Name correction refreshes the SAME Site's display name and regenerates the SAME project's name (not a mismatch, not a new row)", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    const first = await resolveInboundServiceAppointment(
      repo,
      baseInput({ siteAddressName: "Evergreen AHD Speed Demo Acworth", summary: "Install One AHD system", zohoServiceAppointmentNumber: "AP-8" }),
    );
    assert.equal(state.sites[0].name, "Evergreen AHD Speed Demo Acworth");
    assert.equal(state.projects[0].projectName, "Evergreen AHD Speed Demo Acworth — Install One AHD system — AP-8");

    const second = await resolveInboundServiceAppointment(
      repo,
      baseInput({ siteAddressName: "Evergreen Acworth", summary: "Install One AHD system", zohoServiceAppointmentNumber: "AP-8" }),
    );

    assert.equal(second.outcome, "reused_existing");
    assert.equal(second.projectId, first.projectId);
    assert.equal(state.sites.length, 1);
    assert.equal(state.projects.length, 1);
    assert.equal(state.sites[0].name, "Evergreen Acworth");
    assert.equal(state.projects[0].projectName, "Evergreen Acworth — Install One AHD system — AP-8");
    // The denormalized projects.customer_name is kept in sync too, not left stale, so the row
    // stays internally coherent even outside the project-list screen's joined-customer preference.
    assert.equal(state.projects[0].customerName, "Evergreen Acworth");
  });

  it("Summary change alone regenerates the SAME project's name (not a mismatch, not a new row)", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    const first = await resolveInboundServiceAppointment(
      repo,
      baseInput({ siteAddressName: "Evergreen Acworth", summary: "Install One AHD system", zohoServiceAppointmentNumber: "AP-8" }),
    );

    const second = await resolveInboundServiceAppointment(
      repo,
      baseInput({ siteAddressName: "Evergreen Acworth", summary: "Install Two AHD systems", zohoServiceAppointmentNumber: "AP-8" }),
    );

    assert.equal(second.outcome, "reused_existing");
    assert.equal(second.projectId, first.projectId);
    assert.equal(state.projects.length, 1);
    assert.equal(state.projects[0].projectName, "Evergreen Acworth — Install Two AHD systems — AP-8");
  });

  it("(shared Site) two SAs at the same Site (e.g. AP-10 and AP-11): redelivering AP-10 renames the shared Site and regenerates ONLY AP-10's project_name — AP-11's project row is untouched until AP-11 itself is synchronized", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });

    const ap10First = await resolveInboundServiceAppointment(
      repo,
      baseInput({
        zohoServiceAppointmentId: "sa-ap10",
        zohoWorkOrderId: "wo-ap10",
        siteAddressName: "Kennesaw Branch",
        summary: "2 Camera AHD Demo",
        zohoServiceAppointmentNumber: "AP-10",
      }),
    );
    const ap11First = await resolveInboundServiceAppointment(
      repo,
      baseInput({
        zohoServiceAppointmentId: "sa-ap11",
        zohoWorkOrderId: "wo-ap11",
        siteAddressName: "Kennesaw Branch",
        summary: "2 Camera AHD Demo",
        zohoServiceAppointmentNumber: "AP-11",
      }),
    );

    // Sanity: same Site, two distinct projects.
    assert.equal(state.sites.length, 1);
    assert.equal(state.projects.length, 2);
    const ap11ProjectNameBefore = state.projects.find((p) => p.id === ap11First.projectId)?.projectName;
    assert.equal(ap11ProjectNameBefore, "Kennesaw Branch — 2 Camera AHD Demo — AP-11");

    // Only AP-10 is actually edited/redelivered — the Site's Address Name changed in Zoho.
    const ap10Second = await resolveInboundServiceAppointment(
      repo,
      baseInput({
        zohoServiceAppointmentId: "sa-ap10",
        zohoWorkOrderId: "wo-ap10",
        siteAddressName: "Kennesaw Warehouse",
        summary: "2 Camera AHD Demo",
        zohoServiceAppointmentNumber: "AP-10",
      }),
    );

    assert.equal(ap10Second.outcome, "reused_existing");
    assert.equal(ap10Second.projectId, ap10First.projectId);
    assert.equal(state.sites.length, 1, "still one shared Site row, not duplicated");
    // The shared Site is renamed — visible from either project's join.
    assert.equal(state.sites[0].name, "Kennesaw Warehouse");
    // AP-10's OWN project_name regenerates with the new Site name.
    assert.equal(
      state.projects.find((p) => p.id === ap10First.projectId)?.projectName,
      "Kennesaw Warehouse — 2 Camera AHD Demo — AP-10",
    );
    // AP-11's project row is completely untouched — same project_name as before, even though the
    // Site it's linked to (via a live join) now shows the new name. AP-11 only regenerates when
    // AP-11 itself is synchronized.
    const ap11ProjectAfter = state.projects.find((p) => p.id === ap11First.projectId);
    assert.equal(ap11ProjectAfter?.projectName, ap11ProjectNameBefore);
    assert.equal(ap11ProjectAfter?.projectName, "Kennesaw Branch — 2 Camera AHD Demo — AP-11");
  });

  it("(C) withholds descriptive refresh and logs identity_mismatch_on_reuse when the incoming Service_Address.id no longer matches", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    const first = await resolveInboundServiceAppointment(repo, baseInput());
    const originalProjectId = first.projectId;
    const originalAddress = state.sites[0].fullAddress;
    const originalName = state.sites[0].name;

    const second = await resolveInboundServiceAppointment(
      repo,
      baseInput({ zohoServiceAddressId: "some-other-address-id", siteAddressLine: "999 Different St, Nowhere, XX 00000" }),
    );

    assert.equal(second.outcome, "identity_mismatch_on_reuse");
    assert.equal(second.projectId, originalProjectId);
    assert.match(second.detail || "", /Identity mismatch/);
    assert.match(second.detail || "", /some-other-address-id/);
    // Identity and descriptive fields both unchanged — the mismatched payload is not applied.
    assert.equal(state.sites.length, 1);
    assert.equal(state.sites[0].fullAddress, originalAddress);
    assert.equal(state.sites[0].name, originalName);
    assert.equal(state.projects.length, 1);
    assert.equal(state.projects[0].location, originalAddress);
    assert.equal(state.inboundEvents.at(-1)?.outcome, "identity_mismatch_on_reuse");
  });

  it("(D) withholds descriptive refresh and logs identity_mismatch_on_reuse when the incoming OE company differs or is blank/unmapped", async () => {
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

  it("(D-2) logs identity_mismatch_on_reuse when the Zoho dealer/Company id changes while the OE mapping stays the same (previously-undetected gap)", async () => {
    const { repo, state } = createFakeRepo({ companyMappings: { Blaxtair: "company-blaxtair" } });
    const first = await resolveInboundServiceAppointment(repo, baseInput({ zohoCompanyId: "zc-shoppas" }));
    const originalProjectId = first.projectId;

    const differentDealer = await resolveInboundServiceAppointment(
      repo,
      // Same "Installer Sheetz Company" (OE) picklist value, but the Work Order's Zoho Company
      // (dealer) reference changed — must still be flagged, not silently accepted.
      baseInput({ zohoCompanyId: "zc-different-dealer" }),
    );

    assert.equal(differentDealer.outcome, "identity_mismatch_on_reuse");
    assert.equal(differentDealer.projectId, originalProjectId);
    assert.match(differentDealer.detail || "", /zc-different-dealer/);
    assert.equal(state.projects.length, 1);
    assert.equal(state.customerAccounts.length, 1);
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
