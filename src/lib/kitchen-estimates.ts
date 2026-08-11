export type KitchenSizeSetting = {
  pizza_size_id: string;
  simultaneous_capacity: number;
  assembly_minutes: number;
  baking_minutes: number;
  finishing_minutes: number;
};

export type KitchenSettings = {
  oven_count: number;
  oven_width_cm: number;
  oven_depth_cm: number;
  sound_enabled_default: boolean;
  warning_threshold_minutes: number;
  delay_threshold_minutes: number;
  sizes: KitchenSizeSetting[];
};

export type KitchenEstimateItem = {
  id: string;
  status: "pending" | "in_preparation" | "prepared";
  quantity: number;
  size_id: string | null;
  received_at: string;
};

const fallbackSizeSetting: KitchenSizeSetting = {
  pizza_size_id: "",
  simultaneous_capacity: 1,
  assembly_minutes: 2,
  baking_minutes: 8,
  finishing_minutes: 1
};

function sizeSettingFor(settings: KitchenSettings, sizeId: string | null) {
  return settings.sizes.find((size) => size.pizza_size_id === sizeId) ?? fallbackSizeSetting;
}

function ovenLoads(quantity: number, capacity: number) {
  return Math.max(1, Math.ceil(Math.max(1, quantity) / Math.max(1, capacity)));
}

function bakeMinutesForLoads(loads: number, ovenCount: number, bakingMinutes: number) {
  return Math.ceil(loads / Math.max(1, ovenCount)) * Math.max(1, bakingMinutes);
}

export function estimateKitchenMinutes(item: KitchenEstimateItem, previousItems: KitchenEstimateItem[], settings: KitchenSettings) {
  const sizeSetting = sizeSettingFor(settings, item.size_id);
  const previousBakeLoadMinutes = previousItems
    .filter((previous) => previous.status !== "prepared")
    .reduce((sum, previous) => {
      const previousSetting = sizeSettingFor(settings, previous.size_id);
      const loads = ovenLoads(previous.quantity, previousSetting.simultaneous_capacity);
      return sum + loads * previousSetting.baking_minutes;
    }, 0);
  const waitMinutes = Math.floor(previousBakeLoadMinutes / Math.max(1, settings.oven_count));
  const itemLoads = ovenLoads(item.quantity, sizeSetting.simultaneous_capacity);

  return (
    Math.max(0, sizeSetting.assembly_minutes) +
    waitMinutes +
    bakeMinutesForLoads(itemLoads, settings.oven_count, sizeSetting.baking_minutes) +
    Math.max(0, sizeSetting.finishing_minutes)
  );
}

export function kitchenTimingState(elapsedMinutes: number, etaMinutes: number, settings: KitchenSettings) {
  if (elapsedMinutes >= Math.max(etaMinutes, settings.delay_threshold_minutes)) return "delayed";
  if (elapsedMinutes >= Math.min(etaMinutes, settings.warning_threshold_minutes)) return "warning";
  return "normal";
}
