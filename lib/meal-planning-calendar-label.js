/**
 * Meal Planning Calendar Event Label class.
 * @class
 *
 * @param {object} label label
 *
 * @property {string} identifier
 * @property {string} calendarId
 * @property {string} hexColor
 * @property {number} logicalTimestamp
 * @property {string} name
 * @property {number} sortIndex
 *
 */
class MealPlanningCalendarEventLabel {
	/**
   * @hideconstructor
   */
	constructor(label) {
		this.identifier = label.identifier;
		this.calendarId = label.calendarId;
		this.hexColor = label.hexColor;
		this.logicalTimestamp = label.logicalTimestamp;
		this.name = label.name;
		this.sortIndex = label.sortIndex;
	}
}

module.exports = MealPlanningCalendarEventLabel;
