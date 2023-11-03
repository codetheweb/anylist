const EventEmitter = require('events');
const got = require('got');
const WebSocket = require('reconnecting-websocket');
const WS = require('ws');
const protobuf = require('protobufjs');
const FormData = require('form-data');
const crypto = require('crypto');
const fs = require('fs');
const definitions = require('./definitions.json');
const List = require('./list');
const Item = require('./item');
const uuid = require('./uuid');
const Recipe = require('./recipe');
const RecipeCollection = require('./recipe-collection');

const CREDENTIALS_KEY_CLIENT_ID = 'clientId';
const CREDENTIALS_KEY_ACCESS_TOKEN = 'accessToken';
const CREDENTIALS_KEY_REFRESH_TOKEN = 'refreshToken';

/**
 * AnyList class. There should be one
 * instance per account.
 * @class
 * @param {object} options account options
 * @param {string} options.email email
 * @param {string} options.password password
 *
 * @property {List[]} lists
 * @property {Object.<string, Item[]>} recentItems
 * @property {Recipe[]} recipes
 * @fires AnyList#lists-update
 */
class AnyList extends EventEmitter {
	constructor({email, password, credentialsFile = '.anylist_credentials'}) {
		super();

		this.email = email;
		this.password = password;
		this.credentialsFile = credentialsFile;

		this.authClient = got.extend({
			headers: {
				'X-AnyLeaf-API-Version': '3'
			},
			prefixUrl: 'https://www.anylist.com',
			followRedirect: false
		});

		this.client = this.authClient.extend({
			mutableDefaults: true,
			hooks: {
				beforeRequest: [
					options => {
						options.headers = {
							'X-AnyLeaf-Client-Identifier': this.clientId,
							'authorization': `Bearer ${this.accessToken}`,
							...options.headers
						};

						const path = options.url.pathname;
						if (path.startsWith('/data/')) {
							options.responseType = 'buffer';
						}
					}
				],
				afterResponse: [
					async (response, retryWithMergedOptions) => {
						if (response.statusCode != 401) {
							return response;
						}

						console.log("REFRESHING TOKENS");
						await this._refreshTokens();

						return retryWithMergedOptions({
							headers: {
								'authorization': `Bearer ${this.accessToken}`
							}
						});
					}
				]
			}
		});

		this.protobuf = protobuf.newBuilder({}).import(definitions).build('pcov.proto');

		this.lists = [];
		this.recentItems = {};
		this.recipes = [];
		this.recipeDataId = null;
	}

	/**
   * Log into the AnyList account provided
   * in the constructor.
   */
	async login() {
		await this._loadCredentials()
		this.clientId = await this._getClientId();

		if (!this.accessToken || !this.refreshToken) {
			console.log("FETCHING TOKENS");
			await this._fetchTokens();
		}

		this._setupWebSocket();
	}

	async _fetchTokens() {
		const form = new FormData();
		form.append('email', this.email);
		form.append('password', this.password);

		const result = await this.authClient.post('auth/token', {
			body: form
		}).json();

		this.accessToken = result.access_token;
		this.refreshToken = result.refresh_token;
		await this._storeCredentials();
	}

	async _refreshTokens() {
		const form = new FormData();
		form.append('refresh_token', this.refreshToken);

		try {
			const result = await this.authClient.post('auth/token/refresh', {
				body: form
			}).json();

			this.accessToken = result.access_token;
			this.refreshToken = result.refresh_token;
			await this._storeCredentials();
		} catch (error) {
			if (error.response.statusCode != 401) {
				throw error;
			}

			console.log("RE-FETCHING TOKENS");
			await this._fetchTokens();
		}
	}

	async _getClientId() {
		if (this.clientId) {
			return this.clientId;
		}

		console.log("GENERATING CLIENT ID");

		const clientId = uuid();
		this.clientId = clientId;
		await this._storeCredentials();
		return clientId;
	}

	async _loadCredentials() {
		if (!this.credentialsFile) {
			return;
		}

		if (!fs.existsSync(this.credentialsFile)) {
			return;
		}

		try {
			const encrypted = await fs.promises.readFile(this.credentialsFile);
			const credentials = this._decryptCredentials(encrypted, this.password);
			this.clientId = credentials[CREDENTIALS_KEY_CLIENT_ID];
			this.accessToken = credentials[CREDENTIALS_KEY_ACCESS_TOKEN];
			this.refreshToken = credentials[CREDENTIALS_KEY_REFRESH_TOKEN];
		} catch (error) {
			console.error(`Failed to read stored credentials: ${error.stack}`);
		}
	}

	async _storeCredentials() {
		if (!this.credentialsFile) {
			return;
		}

		const credentials = {
			[CREDENTIALS_KEY_CLIENT_ID]: this.clientId,
			[CREDENTIALS_KEY_ACCESS_TOKEN]: this.accessToken,
			[CREDENTIALS_KEY_REFRESH_TOKEN]: this.refreshToken
		};
		try {
			const encrypted = this._encryptCredentials(credentials, this.password);
			await fs.promises.writeFile(this.credentialsFile, encrypted);
		} catch (error) {
			console.error(`Failed to write credentials to storage: ${error.stack}`);
		}
	}

	_encryptCredentials(credentials, secret) {
		const plain = JSON.stringify(credentials);
		const key = crypto.createHash('sha256').update(String(secret)).digest('base64').substring(0, 32);
		const iv = crypto.randomBytes(16);
		const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv);
		let encrypted = cipher.update(plain);
		encrypted = Buffer.concat([encrypted, cipher.final()]);
		return JSON.stringify({
			iv: iv.toString('hex'),
			cipher: encrypted.toString('hex')
		});
	}

	_decryptCredentials(credentials, secret) {
		const encrypted = JSON.parse(credentials);
		const key = crypto.createHash('sha256').update(String(secret)).digest('base64').substring(0, 32);
		const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), Buffer.from(encrypted.iv, 'hex'));
		let plain = decipher.update(Buffer.from(encrypted.cipher, 'hex'));
		plain = Buffer.concat([plain, decipher.final()]);
		return JSON.parse(plain.toString());
	}

	_setupWebSocket() {
		AuthenticatedWebSocket.token = this.accessToken;
		AuthenticatedWebSocket.clientId = this.clientId;

		this.ws = new WebSocket(`wss://www.anylist.com/data/add-user-listener`, [], {
			WebSocket: AuthenticatedWebSocket,
			maxReconnectAttempts: 1,
			reconnectInterval: 0
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

		this.ws.addEventListener('error', async (error) => {
			console.log("WS REFRESHING TOKENS");
			await this._refreshTokens();
			AuthenticatedWebSocket.token = this.accessToken;
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

		decoded.starterListsResponse.recentItemListsResponse.listResponses.forEach(response => {
			const list = response.starterList;
			this.recentItems[list.listId] = list.items.map(item => {
				return new Item(item, this);
			});
		});

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
   * Get the recently added items for a list
   * @param {string} listId list ID
   * @return {Item[]} recently added items array
   */
	getRecentItemsByListId(listId) {
		return this.recentItems[listId];
	}

	/**
   * Factory function to create new Items.
   * @param {object} item new item options
   * @return {Item} item
   */
	createItem(item) {
		return new Item(item, this);
	}

	/**
   * Load all recipes from account into memory.
   * @return {Promise<Recipe[]>} recipes
	*/
	async getRecipes() {
		const result = await this.client.post('data/user-data/get');
		const decoded = this.protobuf.PBUserDataResponse.decode(result.body);

		this.recipes = decoded.recipeDataResponse.recipes.map(recipe => new Recipe(recipe, this));
		this.recipeDataId = decoded.recipeDataResponse.recipeDataId;
		return this.recipes;
	}

	/**
   * Factory function to create new Recipes.
   * @param {object} recipe new recipe options
   * @return {Recipe} recipe
   */
	async createRecipe(recipe) {
		if (!this.recipeDataId) {
			await this.getRecipes();
		}

		return new Recipe(recipe, this);
	}

	/**
   * Factory function to create new Recipe Collections.
   * @param {object} recipeCollection new recipe options
   * @return {RecipeCollection} recipe collection
   */
	createRecipeCollection(recipeCollection) {
		return new RecipeCollection(recipeCollection, this);
	}
}

class AuthenticatedWebSocket extends WS {

	static token;
	static clientId;

	constructor(url, protocols) {
		super(url, protocols, {
			headers: {
				'authorization': `Bearer ${AuthenticatedWebSocket.token}`,
				'x-anyleaf-client-identifier': AuthenticatedWebSocket.clientId,
				'X-AnyLeaf-API-Version': '3'
			}
		});
	}
}

module.exports = AnyList;
