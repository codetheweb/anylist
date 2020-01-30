const EventEmitter = require('events');
const got = require('got');
const WebSocket = require('reconnecting-websocket');
const WS = require('ws');
const protobuf = require('protobufjs');
const {CookieJar} = require('tough-cookie');
const FormData = require('form-data');
const definitions = require('./definitions.json');
const List = require('./lib/list');
const Item = require('./lib/item');
const uuid = require('./lib/uuid');

class AnyList extends EventEmitter {
	constructor({email, password}) {
		super();

		this.email = email;
		this.password = password;

		this.cookieJar = new CookieJar();

		this.clientId = uuid();

		this.client = got.extend({
			headers: {
				'X-AnyLeaf-API-Version': '3',
				'X-AnyLeaf-Client-Identifier': this.clientId
			},
			prefixUrl: 'https://www.anylist.com',
			cookieJar: this.cookieJar,
			followRedirect: false,
			hooks: {
				beforeRequest: [
					options => {
						const url = options.url.href;
						if (url.includes('data') && !url.includes('data/validate-login')) {
							options.responseType = 'buffer';
							options.headers = {
								'X-AnyLeaf-Signed-User-ID': this.signedUserId,
								...options.headers
							};
						}
					}
				]
			}
		});

		this.protobuf = protobuf.newBuilder({}).import(definitions).build('pcov.proto');

		this.lists = [];

		this.Factory = {
			createItem: this._createItem.bind(this)
		};
	}

	async login() {
		// Authentication is saved in cookie jar
		const form = new FormData();

		form.append('email', this.email);
		form.append('password', this.password);

		const res = await this.client.post('data/validate-login', {
			body: form
		}).json();

		this.signedUserId = res.signed_user_id;
		this.uid = res.user_id;

		this._setupWebSocket();
	}

	_setupWebSocket() {
		this.ws = new WebSocket(`wss://www.anylist.com/data/add-user-listener/${this.signedUserId}?client_id=${this.clientId}`, [], {
			WebSocket: WS
		});

		this.ws.addEventListener('open', () => {
			this._heartbeatPing = setInterval(() => {
				this.ws.send('--heartbeat--');
			}, 5000); // Web app heartbeats every 5 seconds
		});

		this.ws.addEventListener('message', async ({data}) => {
			if (data === 'refresh-shopping-lists') {
				this.emit('lists-update', await this.getLists());
			}
		});
	}

	async getLists() {
		const res = await this.client.post('data/user-data/get');

		const decoded = this.protobuf.PBUserDataResponse.decode(res.body);

		this.lists = decoded.shoppingListsResponse.newLists.map(list => new List(list, this));

		return this.lists;
	}

	getListById(id) {
		return this.lists.find(l => l.identifier === id);
	}

	getListByName(name) {
		return this.lists.find(l => l.name === name);
	}

	_createItem(i) {
		return new Item(i, this);
	}
}

module.exports = AnyList;
