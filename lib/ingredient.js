/**
 * Ingredient class (in progress).
 * @class
 *
 * @param {object} ingredient ingredient
 * @param {object} context context
 *
 * @property {string} rawIngredient
 * @property {string} name
 * @property {string} quantity
 * @property {string} note
 */
class Ingredient {
	/**
   * @hideconstructor
   */
	constructor(i, {client, protobuf, uid}) {
		this._rawIngredient = i.rawIngredient;
		this._name = i.name;
		this._quantity = i.quantity;
		this._note = i.note;
		this._client = client;
		this._protobuf = protobuf;
		this._uid = uid;

		this._fieldsToUpdate = [];
	}

	toJSON() {
		return {
			rawIngredient: this._rawIngredient,
			name: this._name,
			quantity: this._quantity,
			note: this._note
		};
	}

	_encode() {
		return new this._protobuf.PBIngredient({
			name: this._name,
			quantity: this._quantity,
			rawIngredient: this._rawIngredient,
			note: this._note
		});
	}

	get rawIngredient() {
		return this._rawIngredient;
	}

	set rawIngredient(n) {
		this._rawIngredient = n;
		this._fieldsToUpdate.push('rawIngredient');
	}

	get name() {
		return this._name;
	}

	set name(n) {
		this._name = n;
		this._fieldsToUpdate.push('name');
	}

	get quantity() {
		return this._quantity;
	}

	set quantity(q) {
		this._quantity = q;
		this._fieldsToUpdate.push('quantity');
	}

	get note() {
		return this._note;
	}

	set note(n) {
		this._note = n;
		this._fieldsToUpdate.push('note');
	}
}

module.exports = Ingredient;
