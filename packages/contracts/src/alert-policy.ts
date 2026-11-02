import * as v from "valibot";

const id = v.pipe(v.string(), v.regex(/^[a-z2-7]{12}$/, "is not an id"));

/** How the workspace follows up on incidents nobody acknowledges. */
export const AlertPolicyInput = v.object({
  /** Minutes between reminders while an incident is open and unacknowledged; 0 sends none. */
  reminderEveryMinutes: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(1440)),
  /** Minutes after which an unacknowledged outage goes to the escalation channels; 0 never escalates. */
  escalateAfterMinutes: v.pipe(v.number(), v.integer(), v.minValue(0), v.maxValue(10_080)),
  escalationChannelIds: v.pipe(v.array(id), v.maxLength(20)),
});
export type AlertPolicy = v.InferOutput<typeof AlertPolicyInput>;
