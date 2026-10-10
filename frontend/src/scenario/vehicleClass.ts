/** Single source for actor class grouping (procedural body selection and integrated-map colours). */
export type VehicleClass =
  | "car"
  | "truck"
  | "bus"
  | "heavy"
  | "motorcycle"
  | "bicycle"
  | "pedestrian"
  | "object"
  | "other";

export function vehicleClass(category: string): VehicleClass {
  if (category === "vehicle.car") return "car";
  if (category === "vehicle.truck") return "truck";
  // Imported OpenSCENARIO uses generic vehicle.bus / vehicle.motorbike categories.
  if (category === "vehicle.bus" || category.startsWith("vehicle.bus."))
    return "bus";
  if (category === "vehicle.trailer" || category === "vehicle.construction")
    return "heavy";
  if (category === "vehicle.motorcycle" || category === "vehicle.motorbike")
    return "motorcycle";
  if (category === "vehicle.bicycle") return "bicycle";
  if (category.startsWith("human.")) return "pedestrian";
  if (/^(movable_object|static_object)\./.test(category)) return "object";
  return "other";
}

/** Integrated-map legend order and Vietnamese labels; colours live in scenario.css. */
export const VEHICLE_CLASS_LABELS: [VehicleClass, string][] = [
  ["car", "Xe con"],
  ["truck", "Xe tải"],
  ["bus", "Xe buýt"],
  ["heavy", "Rơ-moóc / công trình"],
  ["motorcycle", "Xe máy"],
  ["bicycle", "Xe đạp"],
  ["pedestrian", "Người đi bộ"],
  ["object", "Vật cản"],
  ["other", "Khác"],
];
