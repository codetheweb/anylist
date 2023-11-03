const FormData = require('form-data');
const Item = require('./item');
const uuid = require('./uuid');

/**
 * List class.
 * @class
 *
 * @param {object} list list
 * @param {object} context context
 *
 * @property {string} identifier
 * @property {string} name
 * @property {Item[]} items
 */
class List {
	/**
   * @hideconstructor
   */
	constructor(list, {client, protobuf, uid}) {
		this.identifier = list.identifier;
		this.name = list.name;

		this.items = list.items.map(i => new Item(i, {client, protobuf, uid}));
		this.client = client;
		this.protobuf = protobuf;
		this.uid = uid;
	}

	/**
   * Adds an item to this list.
   * Will also save item to local
   * copy of list.
   * @param {Item} item to add
   * @return {Promise<Item>} saved item
   */
	async addItem(item) {
		if (item.constructor !== Item) {
			throw new TypeError('Must be an instance of the Item class.');
		}

		item.listId = this.identifier;

		const op = new this.protobuf.PBListOperation();

		op.setMetadata({
			operationId: uuid(),
			handlerId: 'add-shopping-list-item',
			userId: this.uid,
		});

		op.setListId(this.identifier);
		op.setListItemId(item.identifier);
		op.setListItem(item._encode());

		const ops = new this.protobuf.PBListOperationList();

		ops.setOperations([op]);

		const form = new FormData();

		form.append('operations', ops.toBuffer());

		await this.client.post('data/shopping-lists/update', {
			body: form,
		});

		this.items.push(item);

		return item;
	}

	/**
   * Uncheck all items in a list
   * @return {Promise}
   */

	async uncheckAll() {
		const op = new this.protobuf.PBListOperation();

		op.setMetadata({
			operationId: uuid(),
			handlerId: 'uncheck-all',
			userId: this.uid,
		});

		op.setListId(this.identifier);
		const ops = new this.protobuf.PBListOperationList();
		ops.setOperations([op]);
		const form = new FormData();
		form.append('operations', ops.toBuffer());
		await this.client.post('data/shopping-lists/update', {
			body: form,
		});
	}

	/**
   * Remove an item from this list.
   * Will also remove item from local
   * copy of list.
   * @param {Item} item to remove
   * @return {Promise}
   */
	async removeItem(item) {
		const op = new this.protobuf.PBListOperation();

		op.setMetadata({
			operationId: uuid(),
			handlerId: 'remove-shopping-list-item',
			userId: this.uid,
		});

		op.setListId(this.identifier);
		op.setListItemId(item.identifier);
		op.setListItem(item._encode());

		const ops = new this.protobuf.PBListOperationList();

		ops.setOperations([op]);

		const form = new FormData();

		form.append('operations', ops.toBuffer());

		await this.client.post('data/shopping-lists/update', {
			body: form,
		});

		this.items = this.items.filter(i => i.identifier !== item.identifier);
	}

	/**
   * Get Item from List by identifier.
   * @param {string} identifier item ID
   * @return {Item} found Item
   */
	getItemById(identifier) {
		return this.items.find(i => i.identifier === identifier);
	}

	/**
   * Get Item from List by name.
   * @param {string} name item name
   * @return {Item} found Item
   */
	getItemByName(name) {
		return this.items.find(i => i.name === name);
	}
}

module.exports = List;
