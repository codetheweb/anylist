/// <reference path="./meal-planning-calendar-label.js" />
/// <reference path="./recipe.js" />

/**
 * Meal Planning Calendar Event class.
 * @class
 *
 * @param {object} event event
 * @param {object[]} labels labels
 * @param {object} context context
 *
 * @property {string} identifier
 * @property {string} calendarId
 * @property {Date} date
 * @property {string=} details
 * @property {string=} labelId
 * @property {MealPlanningCalendarEventLabel=} label
 * @property {number=} logicalTimestamp
 * @property {number=} orderAddedSortIndex
 * @property {string=} recipeId
 * @property {Recipe=} recipe
 * @property {number=} recipeScaleFactor
 * @property {string=} title
 */
class MealPlanningCalendarEvent {
	/**
   * @hideconstructor
   */
	constructor(event, {client, protobuf, uid}) {
		this.identifier = event.identifier;
		this.calendarId = event.calendarId;
		this.date = new Date(event.date);
		this.details = event.details;
		this.labelId = event.labelId;
		this.logicalTimestamp = event.logicalTimestamp;
		this.orderAddedSortIndex = event.orderAddedSortIndex;
		this.recipeId = event.recipeId;
		this.recipeScaleFactor = event.recipeScaleFactor;
		this.title = event.title;
		this.recipe = null;
		this.label = null;

		this.client = client;
		this.protobuf = protobuf;
		this.uid = uid;
	}
}

module.exports = MealPlanningCalendarEvent;
