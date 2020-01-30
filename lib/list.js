const FormData = require('form-data');
const Item = require('./item');
const uuid = require('./uuid');

class List {
	constructor(l, {client, protobuf, uid}) {
		this.identifier = l.identifier;
		this.name = l.name;

		this.items = l.items.map(i => new Item(i, {client, protobuf, uid}));
		this.client = client;
		this.protobuf = protobuf;
		this.uid = uid;
	}

	async addItem(i) {
		if (i.constructor !== Item) {
			throw new TypeError('Must be an instance of the Item class.');
		}

		i.listId = this.identifier;

		const op = new this.protobuf.PBListOperation();

		op.setMetadata({
			operationId: uuid(),
			handlerId: 'add-shopping-list-item',
			userId: this.uid
		});

		op.setListId(this.identifier);
		op.setListItemId(i.identifier);
		op.setListItem(i._encode());

		const ops = new this.protobuf.PBListOperationList();

		ops.setOperations([op]);

		const form = new FormData();

		form.append('operations', ops.toBuffer());

		await this.client.post('data/shopping-lists/update', {
			body: form
		});

		this.items.push(i);

		return i;
	}

	async removeItem(i) {
		const op = new this.protobuf.PBListOperation();

		op.setMetadata({
			operationId: uuid(),
			handlerId: 'remove-shopping-list-item',
			userId: this.uid
		});

		op.setListId(this.identifier);
		op.setListItemId(i.identifier);
		op.setListItem(i._encode());

		const ops = new this.protobuf.PBListOperationList();

		ops.setOperations([op]);

		const form = new FormData();

		form.append('operations', ops.toBuffer());

		await this.client.post('data/shopping-lists/update', {
			body: form
		});

		this.items = this.items.filter(item => item.identifier !== i.identifier);
	}

	getItemById(id) {
		return this.items.find(i => i.identifier === id);
	}

	getItemByName(n) {
		return this.items.find(i => i.name === n);
	}
}

module.exports = List;
