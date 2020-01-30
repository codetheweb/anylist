const FormData = require('form-data');
const uuid = require('./uuid');

const OP_MAPPING = {
	name: 'set-list-item-name',
	quantity: 'set-list-item-quantity',
	details: 'set-list-item-details',
	checked: 'set-list-item-checked',
	categoryMatchId: 'set-list-item-category-match-id',
	manualSortIndex: 'set-list-item-sort-order'
};

class Item {
	constructor(i, {client, protobuf, uid}) {
		this._listId = i.listId;
		this._identifier = i.identifier || uuid();
		this._name = i.name;
		this._details = i.details;
		this._quantity = i.quantity;
		this._checked = i.checked;
		this._manualSortIndex = i.manualSortIndex;
		this._userId = i.userId;
		this._categoryMatchId = i.categoryMatchId || 'other';

		this._client = client;
		this._protobuf = protobuf;
		this._uid = uid;

		this._fieldsToUpdate = [];
	}

	_encode() {
		return new this._protobuf.ListItem({
			identifier: this._identifier,
			listId: this._listId,
			name: this._name,
			quantity: this._quantity,
			details: this._details,
			checked: this._checked,
			category: this._category,
			userId: this._userId,
			categoryMatchId: this._categoryMatchId,
			manualSortIndex: this._manualSortIndex
		});
	}

	get identifier() {
		return this._identifier;
	}

	set identifier(_) {
		throw new Error('You cannot update an item ID.');
	}

	get listId() {
		return this._listId;
	}

	set listId(l) {
		if (this._listId === undefined) {
			this._listId = l;
			this._fieldsToUpdate.push('listId');
		} else {
			throw new Error('You cannot move items between lists.');
		}
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
		if (typeof q === 'number') {
			q = q.toString();
		}

		this._quantity = q;
		this._fieldsToUpdate.push('quantity');
	}

	get details() {
		return this._details;
	}

	set details(d) {
		this._details = d;
		this._fieldsToUpdate.push('details');
	}

	get checked() {
		return this._checked;
	}

	set checked(c) {
		if (typeof c !== 'boolean') {
			throw new TypeError('Checked must be a boolean.');
		}

		this._checked = c;
		this._fieldsToUpdate.push('checked');
	}

	get userId() {
		return this._userId;
	}

	set userId(_) {
		throw new Error('Cannot set user ID of an item after creation.');
	}

	get categoryMatchId() {
		return this.categoryMatchId;
	}

	set categoryMatchId(i) {
		this._categoryMatchId = i;
		this._fieldsToUpdate.push('categoryMatchId');
	}

	get manualSortIndex() {
		return this._manualSortIndex;
	}

	set manualSortIndex(i) {
		if (typeof i !== 'number') {
			throw new TypeError('Sort index must be a number.');
		}

		this._manualSortIndex = i;
		this._fieldsToUpdate.push('manualSortIndex');
	}

	async save() {
		const ops = this._fieldsToUpdate.map(field => {
			const value = this[field];
			const opName = OP_MAPPING[field];

			const op = new this._protobuf.PBListOperation();

			op.setMetadata({
				operationId: uuid(),
				handlerId: opName,
				userId: this._uid
			});

			op.setListId(this._listId);
			op.setListItemId(this._identifier);

			if (typeof value === 'boolean') {
				op.setUpdatedValue(value === true ? 'y' : 'n');
			} else {
				op.setUpdatedValue(value.toString());
			}

			return op;
		});

		const opList = new this._protobuf.PBListOperationList();

		opList.setOperations(ops);

		const form = new FormData();

		form.append('operations', opList.toBuffer());

		await this._client.post('data/shopping-lists/update', {
			body: form
		});
	}
}

module.exports = Item;
