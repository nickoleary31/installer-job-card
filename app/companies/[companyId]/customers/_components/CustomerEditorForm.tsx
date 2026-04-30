"use client";

import { CustomerFormState, digitsOnly, formatLicenseKey, formatPhoneNumber } from "../_lib/customerForm";

type Props = {
  form: CustomerFormState;
  onChange: <K extends keyof CustomerFormState>(key: K, value: CustomerFormState[K]) => void;
  showWifiPassword: boolean;
  onToggleWifiPassword: () => void;
  editableFields?: Array<keyof CustomerFormState>;
  visibleFields?: Array<keyof CustomerFormState>;
};

export default function CustomerEditorForm({
  form,
  onChange,
  showWifiPassword,
  onToggleWifiPassword,
  editableFields,
  visibleFields,
}: Props) {
  const isEditable = (field: keyof CustomerFormState) => !editableFields || editableFields.includes(field);
  const isVisible = (field: keyof CustomerFormState) => !visibleFields || visibleFields.includes(field);

  return (
    <div className="space-y-3">
      {isVisible("customer_name") ? (
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">Customer name</label>
        <input
          value={form.customer_name}
          onChange={(e) => onChange("customer_name", e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          placeholder="Required"
          autoComplete="organization"
          disabled={!isEditable("customer_name")}
        />
      </div>
      ) : null}
      {isVisible("full_address") ? (
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">Full address</label>
        <input
          value={form.full_address}
          onChange={(e) => onChange("full_address", e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          autoComplete="street-address"
          disabled={!isEditable("full_address")}
        />
      </div>
      ) : null}
      {isVisible("site_contact_name") ? (
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">Site contact name</label>
        <input
          value={form.site_contact_name}
          onChange={(e) => onChange("site_contact_name", e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          disabled={!isEditable("site_contact_name")}
        />
      </div>
      ) : null}
      {isVisible("contact_number") ? (
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">Contact number</label>
        <input
          value={form.contact_number}
          onChange={(e) => onChange("contact_number", formatPhoneNumber(e.target.value))}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          inputMode="numeric"
          disabled={!isEditable("contact_number")}
        />
      </div>
      ) : null}
      {isVisible("license_key_1") ? (
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">License key 1</label>
        <input
          value={form.license_key_1}
          onChange={(e) => onChange("license_key_1", formatLicenseKey(e.target.value))}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          inputMode="numeric"
          disabled={!isEditable("license_key_1")}
        />
      </div>
      ) : null}
      {isVisible("license_key_2") ? (
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">License key 2</label>
        <input
          value={form.license_key_2}
          onChange={(e) => onChange("license_key_2", formatLicenseKey(e.target.value))}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          inputMode="numeric"
          disabled={!isEditable("license_key_2")}
        />
      </div>
      ) : null}
      {isVisible("server_port_type") ? (
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">Server port type</label>
        <select
          value={form.server_port_type}
          onChange={(e) => onChange("server_port_type", e.target.value as CustomerFormState["server_port_type"])}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          disabled={!isEditable("server_port_type")}
        >
          <option value="">—</option>
          <option value="TLS">TLS</option>
          <option value="Proprietary">Proprietary</option>
        </select>
      </div>
      ) : null}
      {isVisible("server_port_number") ? (
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">Server port number</label>
        <input
          value={form.server_port_number}
          onChange={(e) => onChange("server_port_number", digitsOnly(e.target.value).slice(0, 5))}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          inputMode="numeric"
          disabled={!isEditable("server_port_number")}
        />
      </div>
      ) : null}
      {isVisible("facility_code") ? (
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">Facility code</label>
        <input
          value={form.facility_code}
          onChange={(e) => onChange("facility_code", e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          disabled={!isEditable("facility_code")}
        />
      </div>
      ) : null}
      {isVisible("wifi_ssid") ? (
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">Wi-Fi SSID</label>
        <input
          value={form.wifi_ssid}
          onChange={(e) => onChange("wifi_ssid", e.target.value)}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          autoComplete="off"
          disabled={!isEditable("wifi_ssid")}
        />
      </div>
      ) : null}
      {isVisible("wifi_password") ? (
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">Wi-Fi password</label>
        <div className="flex items-center gap-2">
          <input
            type={showWifiPassword ? "text" : "password"}
            value={form.wifi_password}
            onChange={(e) => onChange("wifi_password", e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
            autoComplete="new-password"
            disabled={!isEditable("wifi_password")}
          />
          <button
            type="button"
            onClick={onToggleWifiPassword}
            className="rounded-lg border border-gray-300 bg-white px-3 py-2 text-xs font-semibold text-gray-700 hover:bg-gray-50"
          >
            {showWifiPassword ? "Hide" : "Show"}
          </button>
        </div>
      </div>
      ) : null}
      {isVisible("notes") ? (
      <div>
        <label className="mb-1 block text-sm font-semibold text-gray-800">Notes</label>
        <textarea
          value={form.notes}
          onChange={(e) => onChange("notes", e.target.value)}
          rows={3}
          className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm text-gray-900"
          disabled={!isEditable("notes")}
        />
      </div>
      ) : null}
    </div>
  );
}

