/*
 * Default checklist content.
 *
 * These seed the `checklists` table the first time the app boots. After that the
 * database is the source of truth and everything here is only used by the
 * "Reset to original" button in the in-app editor.
 *
 * Items are either { type: 'section' } (a heading, not checkable) or
 * { type: 'task' } (a checkable line). Sections drive the per-section progress
 * bars in the app and the grouping in the emailed report.
 */

const DEFAULT_CHECKLISTS = [
  {
    key: 'event-setup',
    title: 'Event Setup',
    icon: '\u{1F389}',
    purpose: 'Prepare the venue before guests arrive.',
    items: [
      { type: 'section', text: 'Clear the training gear' },
      { type: 'task', text: 'SOULRNR sign is taken down' },
      { type: 'task', text: 'Power racks moved outside' },
      { type: 'task', text: 'Weights stacked nice and neatly at the top of the stairs' },
      { type: 'task', text: 'All remaining training equipment stored away (kettlebells, sandbags, wall balls, etc.)' },

      { type: 'section', text: 'Tables and chairs' },
      { type: 'task', text: 'Get table type, quantity, and chair count from Karen' },
      { type: 'task', text: 'Tables and chairs brought up to the main room (renters set them up)' },
      { type: 'task', text: 'Extra tables and chairs are stored neatly' },

      { type: 'section', text: 'Main room and floors' },
      { type: 'task', text: 'Courtyard washed down with Pine-Sol or Lysol — do NOT mop it' },
      { type: 'task', text: 'Main room is clean' },
      { type: 'task', text: 'Floors clean throughout' },
      { type: 'task', text: 'Windows are cleaned' },

      { type: 'section', text: 'Bathrooms and kitchen' },
      { type: 'task', text: 'Bathrooms are clean' },
      { type: 'task', text: 'Toilet paper and paper towels stocked' },
      { type: 'task', text: 'Kitchen is clean and ready' },
      { type: 'task', text: 'Trash cans are empty with fresh liners' },

      { type: 'section', text: 'Outside and entry' },
      { type: 'task', text: 'Entryway is clean' },
      { type: 'task', text: 'Sidewalks in front of the venue blown off' },
      { type: 'task', text: 'Parking lot checked for trash' },

      { type: 'section', text: 'Before you sign off' },
      { type: 'task', text: 'Any special setup instructions are completed' },
    ],
  },
  {
    key: 'venue-turnover',
    title: 'Venue Turnover',
    icon: '\u{1F9F9}',
    purpose: 'Clean and reset the venue after an event.',
    items: [
      { type: 'section', text: 'Trash' },
      { type: 'task', text: 'All trash picked up' },
      { type: 'task', text: 'Trash cans emptied' },
      { type: 'task', text: 'New liners installed' },

      { type: 'section', text: 'Tables, chairs and floors' },
      { type: 'task', text: 'Tables wiped clean' },
      { type: 'task', text: 'Chairs wiped clean if needed' },
      { type: 'task', text: 'Floors swept' },
      { type: 'task', text: 'Floors mopped where needed' },

      { type: 'section', text: 'Kitchen' },
      { type: 'task', text: 'Kitchen cleaned' },
      { type: 'task', text: 'Refrigerator checked for leftover items' },

      { type: 'section', text: 'Bathrooms' },
      { type: 'task', text: 'Bathrooms cleaned' },
      { type: 'task', text: 'Toilet paper restocked' },
      { type: 'task', text: 'Paper towels restocked' },
      { type: 'task', text: 'Soap checked' },

      { type: 'section', text: 'Reset the space' },
      { type: 'task', text: 'Decorations/tape/balloons/signage removed' },
      { type: 'task', text: 'Entryway cleaned' },
      { type: 'task', text: 'Exterior trash checked' },

      { type: 'section', text: 'Final walkthrough' },
      { type: 'task', text: 'Damage checked and documented' },
      { type: 'task', text: 'Supplies checked' },
      { type: 'task', text: 'Venue is clean and ready for next use' },
    ],
  },
  {
    key: 'training-setup',
    title: 'Training Club Setup',
    icon: '\u{1F3CB}️',
    purpose: 'Prepare the venue for SoulRnR / Training Club.',
    items: [
      { type: 'section', text: 'Clear the floor' },
      { type: 'task', text: 'Training area cleared' },
      { type: 'task', text: 'Tables/chairs moved or stored safely' },

      { type: 'section', text: 'Set out the equipment' },
      { type: 'task', text: 'Equipment set out for workout' },
      { type: 'task', text: 'Kettlebells organized' },
      { type: 'task', text: 'Dumbbells organized' },
      { type: 'task', text: 'Sandbags organized' },
      { type: 'task', text: 'Wall balls organized' },
      { type: 'task', text: 'Wall ball targets hung' },
      { type: 'task', text: 'Machines positioned if needed' },

      { type: 'section', text: 'Flow and safety' },
      { type: 'task', text: 'Workout flow is clear' },
      { type: 'task', text: 'Walkways are clear' },
      { type: 'task', text: 'Floor is dry and safe' },
      { type: 'task', text: 'Unused equipment stored neatly' },

      { type: 'section', text: 'Signage and sound' },
      { type: 'task', text: 'Tall HYROX signs and stands brought up' },
      { type: 'task', text: 'Timer/music ready' },

      { type: 'section', text: 'Clean and stock' },
      { type: 'task', text: 'Bathrooms checked' },
      { type: 'task', text: 'Bathroom toilet paper and paper towels refilled' },
      { type: 'task', text: 'Every trash can has a fresh liner' },
      { type: 'task', text: 'Trash can placed by the kitchen area' },
      { type: 'task', text: 'Windows cleaned' },
      { type: 'task', text: 'Doorway to the stairs area is clean' },

      { type: 'section', text: 'Ready for athletes' },
      { type: 'task', text: 'Entry area checked' },
      { type: 'task', text: 'Space is ready for athletes' },
    ],
  },
];

module.exports = { DEFAULT_CHECKLISTS };
