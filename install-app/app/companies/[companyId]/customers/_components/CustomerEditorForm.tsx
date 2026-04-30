"use client";

import { CustomerFormState, digitsOnly, formatLicenseKey, formatPhoneNumber } from "../_lib/customerForm";

type Props = {
  form: CustomerFormState;
  onChange: <K extends keyof CustomerFormState>(key: K, value: CustomerFormState[K]) => void;
};

export default function CustomerEditorForm({ form, onChange }: Props) {
  return (
    <div className="space-y-3">
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">Customer name</label>
        <input
          value={form.customer_name}
          onChange={(e) => onChange("customer_name", e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          placeholder="Required"
          autoComplete="organization"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">Full address</label>
        <input
          value={form.full_address}
          onChange={(e) => onChange("full_address", e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          autoComplete="street-address"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">Site contact name</label>
        <input
          value={form.site_contact_name}
          onChange={(e) => onChange("site_contact_name", e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">Contact number</label>
        <input
          value={form.contact_number}
          onChange={(e) => onChange("contact_number", formatPhoneNumber(e.target.value))}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          inputMode="numeric"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">License key 1</label>
        <input
          value={form.license_key_1}
          onChange={(e) => onChange("license_key_1", formatLicenseKey(e.target.value))}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          inputMode="numeric"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">License key 2</label>
        <input
          value={form.license_key_2}
          onChange={(e) => onChange("license_key_2", formatLicenseKey(e.target.value))}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          inputMode="numeric"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">Server port type</label>
        <select
          value={form.server_port_type}
          onChange={(e) => onChange("server_port_type", e.target.value as CustomerFormState["server_port_type"])}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
        >
          <option value="">—</option>
          <option value="TLS">TLS</option>
          <option value="Proprietary">Proprietary</option>
        </select>
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">Server port number</label>
        <input
          value={form.server_port_number}
          onChange={(e) => onChange("server_port_number", digitsOnly(e.target.value).slice(0, 5))}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          inputMode="numeric"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">Facility code</label>
        <input
          value={form.facility_code}
          onChange={(e) => onChange("facility_code", e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">Wi-Fi SSID</label>
        <input
          value={form.wifi_ssid}
          onChange={(e) => onChange("wifi_ssid", e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          autoComplete="off"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">Wi-Fi password</label>
        <input
          type="password"
          value={form.wifi_password}
          onChange={(e) => onChange("wifi_password", e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          autoComplete="new-password"
        />
      </div>
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">Notes</label>
        <textarea
          value={form.notes}
          onChange={(e) => onChange("notes", e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
        />
      </div>
    </div>
  );
}

