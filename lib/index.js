const EventEmitter = require('events');
const got = require('got');
const WebSocket = require('reconnecting-websocket');
const WS = require('ws');
const protobuf = require('protobufjs');
const {CookieJar} = require('tough-cookie');
const FormData = require('form-data');
const definitions = require('./definitions.json');
const List = require('./list');
const Item = require('./item');
const uuid = require('./uuid');

/**
 * AnyList class. There should be one
 * instance per account.
 * @class
 * @param {object} options account options
 * @param {string} options.email email
 * @param {string} options.password password
 *
 * @property {List[]} lists
 *
 * @fires AnyList#lists-update
 */
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
	}

	/**
   * Log into the AnyList account provided
   * in the constructor.
   */
	async login() {
		// Authentication is saved in cookie jar
		const form = new FormData();

		form.append('email', this.email);
		form.append('password', this.password);

		const result = await this.client.post('data/validate-login', {
			body: form
		}).json();

		this.signedUserId = result.signed_user_id;
		this.uid = result.user_id;

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
				/**
         * Lists update event
         * (fired when any list is modified by an outside actor).
         * The instance's `.lists` are updated before the event fires.
         *
         * @event AnyList#lists-update
         * @type {List[]} updated lists
         */
				this.emit('lists-update', await this.getLists());
			}
		});
	}

	/**
   * Call when you're ready for your program
   * to exit.
   */
	teardown() {
		clearInterval(this._heartbeatPing);
		this.ws.close();
	}

	/**
   * Load all lists from account into memory.
   * @return {Promise<List[]>} lists
   */
	async getLists() {
		const result = await this.client.post('data/user-data/get');

		const decoded = this.protobuf.PBUserDataResponse.decode(result.body);

		this.lists = decoded.shoppingListsResponse.newLists.map(list => new List(list, this));

		return this.lists;
	}

	/**
   * Get List instance by ID.
   * @param {string} identifier list ID
   * @return {List} list
   */
	getListById(identifier) {
		return this.lists.find(l => l.identifier === identifier);
	}

	/**
   * Get List instance by name.
   * @param {string} name list name
   * @return {List} list
   */
	getListByName(name) {
		return this.lists.find(l => l.name === name);
	}

	/**
   * Factory function to create new Items.
   * @param {object} item new item options
   * @return {Item} item
   */
	createItem(item) {
		return new Item(item, this);
	}
}

module.exports = AnyList;
