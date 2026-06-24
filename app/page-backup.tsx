"use client";
import { useState, type ReactNode } from "react";

const hardwareTypes = [
  "VAC4",
  "CP4",
  "PPD",
  "Speed Transmon",
  "Speed SSC",
  "FTxw",
];

function VAC4Section({ children }: { children: ReactNode }) {
  return <>{children}</>;
}

export default function Page() {
  const [primary, setPrimary] = useState("");
  const [hasAdditional, setHasAdditional] = useState("");
  const [additional, setAdditional] = useState<string[]>([]);
  const [vac4VehicleType, setVac4VehicleType] = useState("");
  const [vac4OtherVehicleType, setVac4OtherVehicleType] = useState("");
  const [vac4DriveType, setVac4DriveType] = useState("");
  const [vac4VehicleVoltage, setVac4VehicleVoltage] = useState("");
  const [vac4ClientApproval, setVac4ClientApproval] = useState("");
  const [vac4HourMeter, setVac4HourMeter] = useState("");
  const [sensorHubInstalled, setSensorHubInstalled] = useState("");
  const [liftSenseInstalled, setLiftSenseInstalled] = useState("");
  const [speedSenseInstalled, setSpeedSenseInstalled] = useState("");
  const [loadSenseInstalled, setLoadSenseInstalled] = useState("");
  const [gpsInstalled, setGpsInstalled] = useState("");
  const [externalIndicatorInstalled, setExternalIndicatorInstalled] = useState("");
  const [speedSenseDescription, setSpeedSenseDescription] = useState("");
  const [speedSensePulseCount, setSpeedSensePulseCount] = useState("");
  const [loadSenseThresholds, setLoadSenseThresholds] = useState("");
  const [redWireDescription, setRedWireDescription] = useState("");
  const [blackWireDescription, setBlackWireDescription] = useState("");
  const [blueWireDescription, setBlueWireDescription] = useState("");
  const [brownWireDescription, setBrownWireDescription] = useState("");
  const [vacMountingPhotoCount, setVacMountingPhotoCount] = useState(0);
  const [wirePathPhotoCount, setWirePathPhotoCount] = useState(0);
  const [redWirePhotoCount, setRedWirePhotoCount] = useState(0);
  const [blackWirePhotoCount, setBlackWirePhotoCount] = useState(0);
  const [blueWirePhotoCount, setBlueWirePhotoCount] = useState(0);
  const [brownWirePhotoCount, setBrownWirePhotoCount] = useState(0);
  const [sensorHubMountingPhotoCount, setSensorHubMountingPhotoCount] = useState(0);
  const [speedSensePhotoCount, setSpeedSensePhotoCount] = useState(0);
  const [loadSensePhotoCount, setLoadSensePhotoCount] = useState(0);
  const [gpsPhotoCount, setGpsPhotoCount] = useState(0);
  const [externalIndicatorPhotoCount, setExternalIndicatorPhotoCount] = useState(0);
  const [vac4Error, setVac4Error] = useState(false);

  const availableAdditional = hardwareTypes.filter((h) => h !== primary);
  const inputClassName =
    "w-full p-3 border border-gray-300 rounded bg-gray-50 text-gray-900 placeholder-gray-400";
  const selectClassName = "w-full p-3 border border-gray-300 rounded bg-gray-50 text-gray-900";
  const labelClassName = "block text-gray-800 font-medium mb-1";
  const blueWireHelperText =
    vac4DriveType === "Electric"
      ? "Motion"
      : vac4DriveType === "Internal Combustion"
        ? "In-gear"
        : "Motion / In-gear";
  const brownWireHelperText =
    vac4DriveType === "Electric" && liftSenseInstalled === "Yes"
      ? "Lift"
      : vac4DriveType === "Internal Combustion"
        ? "Engine-on"
        : "Lift / Engine-on";

  const toggleAdditional = (type: string) => {
    if (additional.includes(type)) {
      setAdditional(additional.filter((a) => a !== type));
    } else {
      setAdditional([...additional, type]);
    }
  };
  const selectedSections = [primary, ...additional].filter(Boolean);

  const validateVac4Section = () => {
    const isElectricDrive = vac4DriveType === "Electric";
    const isInternalCombustionDrive = vac4DriveType === "Internal Combustion";
    const isBlueWireRequired = isInternalCombustionDrive || (isElectricDrive && liftSenseInstalled === "Yes");
    const isBrownWireRequired = isInternalCombustionDrive || (isElectricDrive && liftSenseInstalled === "Yes");

    if (!vac4VehicleType) return false;
    if (vac4VehicleType === "Other" && !vac4OtherVehicleType.trim()) return false;
    if (!vac4DriveType) return false;
    if (isElectricDrive && !vac4VehicleVoltage.trim()) return false;
    if (isElectricDrive && !liftSenseInstalled) return false;
    if (!vac4ClientApproval.trim()) return false;
    if (!vac4HourMeter.trim()) return false;

    if (vacMountingPhotoCount < 1 || wirePathPhotoCount < 1) return false;
    if (redWirePhotoCount < 1 || !redWireDescription.trim()) return false;
    if (blackWirePhotoCount < 1 || !blackWireDescription.trim()) return false;
    if (isBlueWireRequired && (blueWirePhotoCount < 1 || !blueWireDescription.trim())) return false;
    if (isBrownWireRequired && (brownWirePhotoCount < 1 || !brownWireDescription.trim())) return false;

    if (sensorHubInstalled === "Yes") {
      if (sensorHubMountingPhotoCount < 1) return false;
      if (speedSenseInstalled === "Yes") {
        if (speedSensePhotoCount < 1) return false;
        if (!speedSenseDescription.trim() || !speedSensePulseCount.trim()) return false;
      }
      if (loadSenseInstalled === "Yes") {
        if (loadSensePhotoCount < 1 || !loadSenseThresholds.trim()) return false;
      }
      if (gpsInstalled === "Yes" && gpsPhotoCount < 1) return false;
      if (externalIndicatorInstalled === "Yes" && externalIndicatorPhotoCount < 1) return false;
    }

    return true;
  };

  const handleSubmit = () => {
    const hasVac4 = selectedSections.includes("VAC4");

    if (hasVac4 && !validateVac4Section()) {
      setVac4Error(true);
      return;
    }

    setVac4Error(false);
  };

  return (
    <div className="min-h-screen bg-gray-200 p-6">
      <div className="max-w-3xl mx-auto space-y-6">
        <h1 className="text-3xl font-bold text-gray-900">Installer Job Card</h1>

        {/* Core Info */}
        <div className="bg-white border border-gray-300 p-5 rounded-xl shadow-md">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Core Job Info</h2>

          <div className="mb-3">
            <label className="block text-gray-800 font-medium mb-1">Customer</label>
            <input
              className="w-full p-3 border border-gray-300 rounded bg-gray-50 text-gray-900 placeholder-gray-400"
              placeholder="Enter customer name"
            />
          </div>

          <div className="mb-3">
            <label className="block text-gray-800 font-medium mb-1">Location</label>
            <input
              className="w-full p-3 border border-gray-300 rounded bg-gray-50 text-gray-900 placeholder-gray-400"
              placeholder="Enter location"
            />
          </div>

          <div className="mb-3">
            <label className="block text-gray-800 font-medium mb-1">Work Order #</label>
            <input
              className="w-full p-3 border border-gray-300 rounded bg-gray-50 text-gray-900 placeholder-gray-400"
              placeholder="Enter work order #"
            />
          </div>

          <div className="mb-3">
            <label className="block text-gray-800 font-medium mb-1">Service Appointment #</label>
            <input
              className="w-full p-3 border border-gray-300 rounded bg-gray-50 text-gray-900 placeholder-gray-400"
              placeholder="Enter service appointment #"
            />
          </div>

          <div className="mb-3">
            <label className="block text-gray-800 font-medium mb-1">Unit Number</label>
            <input
              className="w-full p-3 border border-gray-300 rounded bg-gray-50 text-gray-900 placeholder-gray-400"
              placeholder="Enter unit number"
            />
          </div>

          <div className="mb-3">
            <label className="block text-gray-800 font-medium mb-1">Installer Name</label>
            <input
              className="w-full p-3 border border-gray-300 rounded bg-gray-50 text-gray-900 placeholder-gray-400"
              placeholder="Enter installer name"
            />
          </div>
        </div>

        {/* Hardware Selection */}
        <div className="bg-white border border-gray-300 p-5 rounded-xl shadow-md">
          <h2 className="text-xl font-semibold mb-4 text-gray-800">Hardware Selection</h2>

          <div className="mb-3">
            <label className="block text-gray-800 font-medium mb-1">Primary Hardware / Install Type</label>
            <select
              className="w-full p-3 border border-gray-300 rounded bg-gray-50 text-gray-900"
              value={primary}
              onChange={(e) => setPrimary(e.target.value)}
            >
              <option value="" className="text-gray-400">
                Select Primary Hardware
              </option>
              <option value="VAC4">VAC4</option>
              <option value="CP4">CP4</option>
              <option value="PPD">PPD</option>
              <option value="Speed Transmon">Speed Transmon</option>
              <option value="Speed SSC">Speed SSC</option>
              <option value="FTxw">FTxw</option>
            </select>
          </div>

          <div className="mb-3">
            <label className="block text-gray-800 font-medium mb-1">Is any additional hardware being installed?</label>
            <select
              className="w-full p-3 border border-gray-300 rounded bg-gray-50 text-gray-900"
              value={hasAdditional}
              onChange={(e) => setHasAdditional(e.target.value)}
            >
              <option value="" className="text-gray-400">
                Any additional hardware?
              </option>
              <option value="Yes">Yes</option>
              <option value="No">No</option>
            </select>
          </div>

          {hasAdditional === "Yes" && primary && (
            <div className="space-y-2 mt-3">
              {availableAdditional.map((type) => (
                <label key={type} className="block text-gray-700">
                  <input
                    type="checkbox"
                    className="mr-2"
                    checked={additional.includes(type)}
                    onChange={() => toggleAdditional(type)}
                  />
                  {type}
                </label>
              ))}
            </div>
          )}
        </div>
        <p className="text-red-600 font-bold">Selected Primary: {primary}</p>

        {primary === "VAC4" && (
          <VAC4Section>
            <div className="bg-white border border-gray-300 p-5 rounded-xl shadow-md space-y-4">
                <h2 className="text-xl font-semibold text-gray-800">VAC4 Section</h2>
                {vac4Error && (
                  <p className="rounded-md border border-red-300 bg-red-50 p-3 text-sm font-medium text-red-700">
                    Please complete all required fields and photos
                  </p>
                )}

                <div>
                  <label className={labelClassName}>Vehicle Type</label>
                  <select
                    className={selectClassName}
                    value={vac4VehicleType}
                    onChange={(e) => setVac4VehicleType(e.target.value)}
                  >
                    <option value="" className="text-gray-400">
                      Select vehicle type
                    </option>
                    <option>Forklift Rider</option>
                    <option>Forklift Stand-up</option>
                    <option>Man Lift</option>
                    <option>Order Picker</option>
                    <option>Pallet Jack Rider</option>
                    <option>Pallet Jack Walkie</option>
                    <option>Reach Truck</option>
                    <option>Stacker Rider</option>
                    <option>Stacker Walkie</option>
                    <option>Sweeper/Scrubber</option>
                    <option>Tugger/Tow Tractor</option>
                    <option>Turret Truck</option>
                    <option>Other</option>
                  </select>
                </div>

                {vac4VehicleType === "Other" && (
                  <div>
                    <label className={labelClassName}>Other Vehicle Type</label>
                    <input
                      className={inputClassName}
                      placeholder="Enter vehicle type"
                      value={vac4OtherVehicleType}
                      onChange={(e) => setVac4OtherVehicleType(e.target.value)}
                    />
                  </div>
                )}

                <div>
                  <label className={labelClassName}>Drive Type</label>
                  <select
                    className={selectClassName}
                    value={vac4DriveType}
                    onChange={(e) => setVac4DriveType(e.target.value)}
                  >
                    <option value="" className="text-gray-400">
                      Select drive type
                    </option>
                    <option>Electric</option>
                    <option>Internal Combustion</option>
                    <option>Other</option>
                  </select>
                </div>

                {vac4DriveType === "Electric" && (
                  <div>
                    <label className={labelClassName}>Vehicle Voltage</label>
                    <input
                      className={inputClassName}
                      placeholder="Enter vehicle voltage"
                      value={vac4VehicleVoltage}
                      onChange={(e) => setVac4VehicleVoltage(e.target.value)}
                    />
                  </div>
                )}

                <div>
                  <label className={labelClassName}>Client Representative Approval Details</label>
                  <input
                    className={inputClassName}
                    placeholder="Name, signature confirmation, date/time"
                    value={vac4ClientApproval}
                    onChange={(e) => setVac4ClientApproval(e.target.value)}
                  />
                </div>

                <div>
                  <label className={labelClassName}>Hour Meter Entered During Configuration</label>
                  <input
                    className={inputClassName}
                    placeholder="Enter hour meter value"
                    value={vac4HourMeter}
                    onChange={(e) => setVac4HourMeter(e.target.value)}
                  />
                </div>

                {vac4DriveType === "Electric" && (
                  <div>
                    <label className={labelClassName}>Lift Sense Installed?</label>
                    <select
                      className={selectClassName}
                      value={liftSenseInstalled}
                      onChange={(e) => setLiftSenseInstalled(e.target.value)}
                    >
                      <option value="" className="text-gray-400">
                        Select Yes or No
                      </option>
                      <option>Yes</option>
                      <option>No</option>
                    </select>
                  </div>
                )}

                <div>
                  <label className={labelClassName}>Sensor Hub Installed?</label>
                  <select
                    className={selectClassName}
                    value={sensorHubInstalled}
                    onChange={(e) => setSensorHubInstalled(e.target.value)}
                  >
                    <option value="" className="text-gray-400">
                      Select Yes or No
                    </option>
                    <option>Yes</option>
                    <option>No</option>
                  </select>
                </div>

                {sensorHubInstalled === "Yes" && (
                  <div className="space-y-4 border border-gray-200 rounded-lg p-4 bg-gray-50">
                    <div>
                      <label className={labelClassName}>Sensor Hub Mounting Location</label>
                      <input className={inputClassName} placeholder="Describe mounting location" />
                    </div>
                    <div>
                      <label className={labelClassName}>Sensor Hub Mounting Location Photo</label>
                      <input
                        id="sensorHubMountingPhoto"
                        type="file"
                        className="hidden"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => setSensorHubMountingPhotoCount(e.target.files?.length ?? 0)}
                      />
                      <label
                        htmlFor="sensorHubMountingPhoto"
                        className="w-full p-4 rounded-xl border-2 border-dashed bg-gray-100 text-gray-900 font-medium text-center block cursor-pointer"
                      >
                        📷 Take / Upload Photo
                      </label>
                    </div>

                    <div>
                      <label className={labelClassName}>Speed Sense Installed?</label>
                      <select
                        className={selectClassName}
                        value={speedSenseInstalled}
                        onChange={(e) => setSpeedSenseInstalled(e.target.value)}
                      >
                        <option value="" className="text-gray-400">
                          Select Yes or No
                        </option>
                        <option>Yes</option>
                        <option>No</option>
                      </select>
                    </div>

                    <div>
                      <label className={labelClassName}>Load Sense Installed?</label>
                      <select
                        className={selectClassName}
                        value={loadSenseInstalled}
                        onChange={(e) => setLoadSenseInstalled(e.target.value)}
                      >
                        <option value="" className="text-gray-400">
                          Select Yes or No
                        </option>
                        <option>Yes</option>
                        <option>No</option>
                      </select>
                    </div>

                    <div>
                      <label className={labelClassName}>GPS Installed?</label>
                      <select
                        className={selectClassName}
                        value={gpsInstalled}
                        onChange={(e) => setGpsInstalled(e.target.value)}
                      >
                        <option value="" className="text-gray-400">
                          Select Yes or No
                        </option>
                        <option>Yes</option>
                        <option>No</option>
                      </select>
                    </div>

                    <div>
                      <label className={labelClassName}>External Indicator Installed?</label>
                      <select
                        className={selectClassName}
                        value={externalIndicatorInstalled}
                        onChange={(e) => setExternalIndicatorInstalled(e.target.value)}
                      >
                        <option value="" className="text-gray-400">
                          Select Yes or No
                        </option>
                        <option>Yes</option>
                        <option>No</option>
                      </select>
                    </div>

                    {speedSenseInstalled === "Yes" && (
                      <div className="space-y-3 border border-gray-200 rounded-lg p-4 bg-white">
                        <h3 className="font-semibold text-gray-800">Speed Sense Details</h3>
                        <div>
                          <label className={labelClassName}>Speed Sense Photo</label>
                          <input
                            id="speedSensePhoto"
                            type="file"
                            className="hidden"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => setSpeedSensePhotoCount(e.target.files?.length ?? 0)}
                          />
                          <label
                            htmlFor="speedSensePhoto"
                            className="w-full p-4 rounded-xl border-2 border-dashed bg-gray-100 text-gray-900 font-medium text-center block cursor-pointer"
                          >
                            📷 Take / Upload Photo
                          </label>
                        </div>
                        <div>
                          <label className={labelClassName}>Speed Sense Description</label>
                          <input
                            className={inputClassName}
                            placeholder="Describe speed sense install"
                            value={speedSenseDescription}
                            onChange={(e) => setSpeedSenseDescription(e.target.value)}
                          />
                        </div>
                        <div>
                          <label className={labelClassName}>Speed Sense Pulse Count</label>
                          <input
                            className={inputClassName}
                            placeholder="Enter pulse count"
                            value={speedSensePulseCount}
                            onChange={(e) => setSpeedSensePulseCount(e.target.value)}
                          />
                        </div>
                      </div>
                    )}

                    {loadSenseInstalled === "Yes" && (
                      <div className="space-y-3 border border-gray-200 rounded-lg p-4 bg-white">
                        <h3 className="font-semibold text-gray-800">Load Sense Details</h3>
                        <div>
                          <label className={labelClassName}>Load Sense Photo</label>
                          <input
                            id="loadSensePhoto"
                            type="file"
                            className="hidden"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => setLoadSensePhotoCount(e.target.files?.length ?? 0)}
                          />
                          <label
                            htmlFor="loadSensePhoto"
                            className="w-full p-4 rounded-xl border-2 border-dashed bg-gray-100 text-gray-900 font-medium text-center block cursor-pointer"
                          >
                            📷 Take / Upload Photo
                          </label>
                        </div>
                        <div>
                          <label className={labelClassName}>Load Sense VAC Thresholds</label>
                          <input
                            className={inputClassName}
                            placeholder="Enter VAC thresholds"
                            value={loadSenseThresholds}
                            onChange={(e) => setLoadSenseThresholds(e.target.value)}
                          />
                        </div>
                      </div>
                    )}

                    {gpsInstalled === "Yes" && (
                      <div className="space-y-3 border border-gray-200 rounded-lg p-4 bg-white">
                        <h3 className="font-semibold text-gray-800">GPS Details</h3>
                        <div>
                          <label className={labelClassName}>GPS Mounting Location Photo</label>
                          <input
                            id="gpsMountingPhoto"
                            type="file"
                            className="hidden"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => setGpsPhotoCount(e.target.files?.length ?? 0)}
                          />
                          <label
                            htmlFor="gpsMountingPhoto"
                            className="w-full p-4 rounded-xl border-2 border-dashed bg-gray-100 text-gray-900 font-medium text-center block cursor-pointer"
                          >
                            📷 Take / Upload Photo
                          </label>
                        </div>
                      </div>
                    )}

                    {externalIndicatorInstalled === "Yes" && (
                      <div className="space-y-3 border border-gray-200 rounded-lg p-4 bg-white">
                        <h3 className="font-semibold text-gray-800">External Indicator Details</h3>
                        <div>
                          <label className={labelClassName}>External Indicator Mounting Location Photo</label>
                          <input
                            id="externalIndicatorPhoto"
                            type="file"
                            className="hidden"
                            accept="image/*"
                            capture="environment"
                            onChange={(e) => setExternalIndicatorPhotoCount(e.target.files?.length ?? 0)}
                          />
                          <label
                            htmlFor="externalIndicatorPhoto"
                            className="w-full p-4 rounded-xl border-2 border-dashed bg-gray-100 text-gray-900 font-medium text-center block cursor-pointer"
                          >
                            📷 Take / Upload Photo
                          </label>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="space-y-4 border border-gray-200 rounded-lg p-4 bg-gray-50">
                  <h3 className="font-semibold text-gray-800">VAC4 Required Photos</h3>

                  <div>
                    <label className={labelClassName}>VAC Mounting Location Photo</label>
                    <input
                      id="vacMountingPhoto"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => setVacMountingPhotoCount(e.target.files?.length ?? 0)}
                    />
                    <label
                      htmlFor="vacMountingPhoto"
                      className="w-full p-4 rounded-xl border-2 border-dashed bg-gray-100 text-gray-900 font-medium text-center block cursor-pointer"
                    >
                      📷 Take / Upload Photo
                    </label>
                  </div>
                  <div>
                    <label className={labelClassName}>Wire Path Photos</label>
                    <input
                      id="wirePathPhotos"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      multiple
                      onChange={(e) => setWirePathPhotoCount(e.target.files?.length ?? 0)}
                    />
                    <label
                      htmlFor="wirePathPhotos"
                      className="w-full p-4 rounded-xl border-2 border-dashed bg-gray-100 text-gray-900 font-medium text-center block cursor-pointer"
                    >
                      📷 Take / Upload Photos
                    </label>
                    <p className="mt-1 text-sm text-gray-600">
                      Upload multiple photos showing the full wire route from device to connection points.
                    </p>
                  </div>

                  <div>
                    <label className={labelClassName}>Red Wire Connection Photo</label>
                    <p className="text-sm text-gray-600">Battery positive</p>
                    <input
                      id="redWirePhoto"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => setRedWirePhotoCount(e.target.files?.length ?? 0)}
                    />
                    <label
                      htmlFor="redWirePhoto"
                      className="w-full p-4 rounded-xl border-2 border-dashed bg-gray-100 text-gray-900 font-medium text-center block cursor-pointer mb-2"
                    >
                      📷 Take / Upload Photo
                    </label>
                    <input
                      className={inputClassName}
                      placeholder="Red wire connection description"
                      value={redWireDescription}
                      onChange={(e) => setRedWireDescription(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelClassName}>Black Wire Connection Photo</label>
                    <p className="text-sm text-gray-600">Battery negative</p>
                    <input
                      id="blackWirePhoto"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => setBlackWirePhotoCount(e.target.files?.length ?? 0)}
                    />
                    <label
                      htmlFor="blackWirePhoto"
                      className="w-full p-4 rounded-xl border-2 border-dashed bg-gray-100 text-gray-900 font-medium text-center block cursor-pointer mb-2"
                    >
                      📷 Take / Upload Photo
                    </label>
                    <input
                      className={inputClassName}
                      placeholder="Black wire connection description"
                      value={blackWireDescription}
                      onChange={(e) => setBlackWireDescription(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelClassName}>Blue Wire Connection Photo</label>
                    <p className="text-sm text-gray-600">{blueWireHelperText}</p>
                    <input
                      id="blueWirePhoto"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      onChange={(e) => setBlueWirePhotoCount(e.target.files?.length ?? 0)}
                    />
                    <label
                      htmlFor="blueWirePhoto"
                      className="w-full p-4 rounded-xl border-2 border-dashed bg-gray-100 text-gray-900 font-medium text-center block cursor-pointer mb-2"
                    >
                      📷 Take / Upload Photo
                    </label>
                    <input
                      className={inputClassName}
                      placeholder="Blue wire connection description"
                      value={blueWireDescription}
                      onChange={(e) => setBlueWireDescription(e.target.value)}
                    />
                  </div>
                  <div>
                    <label className={labelClassName}>Purple Wire Connection Photo</label>
                    <p className="text-sm text-gray-600">Operator presence</p>
                    <input id="purpleWirePhoto" type="file" className="hidden" accept="image/*" capture="environment" required />
                    <label
                      htmlFor="purpleWirePhoto"
                      className="w-full p-4 rounded-xl border-2 border-dashed bg-gray-100 text-gray-900 font-medium text-center block cursor-pointer mb-2"
                    >
                      📷 Take / Upload Photo
                    </label>
                    <input className={inputClassName} placeholder="Purple wire connection description" />
                  </div>
                  {(vac4DriveType === "Internal Combustion" ||
                    (vac4DriveType === "Electric" && liftSenseInstalled === "Yes")) && (
                    <div>
                      <label className={labelClassName}>Brown Wire Connection Photo</label>
                      <p className="text-sm text-gray-600">{brownWireHelperText}</p>
                      <input
                        id="brownWirePhoto"
                        type="file"
                        className="hidden"
                        accept="image/*"
                        capture="environment"
                        onChange={(e) => setBrownWirePhotoCount(e.target.files?.length ?? 0)}
                      />
                      <label
                        htmlFor="brownWirePhoto"
                        className="w-full p-4 rounded-xl border-2 border-dashed bg-gray-100 text-gray-900 font-medium text-center block cursor-pointer mb-2"
                      >
                        📷 Take / Upload Photo
                      </label>
                      <input
                        className={inputClassName}
                        placeholder="Brown wire connection description"
                        value={brownWireDescription}
                        onChange={(e) => setBrownWireDescription(e.target.value)}
                      />
                    </div>
                  )}

                  <div>
                    <label className={labelClassName}>Relay Access Control Connection(s) Photo</label>
                    <input
                      id="relayAccessControlPhoto"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      required
                    />
                    <label
                      htmlFor="relayAccessControlPhoto"
                      className="w-full p-4 rounded-xl border-2 border-dashed bg-gray-100 text-gray-900 font-medium text-center block cursor-pointer mb-2"
                    >
                      📷 Take / Upload Photo
                    </label>
                    <input className={inputClassName} placeholder="Relay access control connection description" />
                  </div>
                  <div>
                    <label className={labelClassName}>Impact Sensor Mounting Photo</label>
                    <input
                      id="impactSensorMountingPhoto"
                      type="file"
                      className="hidden"
                      accept="image/*"
                      capture="environment"
                      required
                    />
                    <label
                      htmlFor="impactSensorMountingPhoto"
                      className="w-full p-4 rounded-xl border-2 border-dashed bg-gray-100 text-gray-900 font-medium text-center block cursor-pointer mb-2"
                    >
                      📷 Take / Upload Photo
                    </label>
                    <input className={inputClassName} placeholder="Impact sensor mounting description" />
                  </div>
                </div>
            </div>
          </VAC4Section>
        )}

        {/* Dynamic Sections */}
        {selectedSections
          .filter((section) => section !== "VAC4")
          .map((section) => (
            <div key={section} className="bg-white border border-gray-300 p-5 rounded-xl shadow-md">
              <h2 className="text-xl font-semibold mb-4 text-gray-800">{section} Section</h2>

              <select className="w-full p-3 border border-gray-300 rounded bg-gray-50 text-gray-900 mb-3">
                <option>Drive Type</option>
                <option>Electric</option>
                <option>Internal Combustion</option>
                <option>Other</option>
              </select>

              <input
                className="w-full p-3 border border-gray-300 rounded mb-3 bg-gray-50 text-gray-900 placeholder-gray-400"
                placeholder="Notes / Details"
              />

              <input type="file" className="w-full mb-2" />
            </div>
          ))}

        <button className="w-full bg-gray-900 text-white p-3 rounded-xl hover:bg-black" onClick={handleSubmit}>
          Submit (placeholder)
        </button>
      </div>
    </div>
  );
}
