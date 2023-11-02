const EventEmitter = require('events');
const got = require('got');
const WebSocket = require('reconnecting-websocket');
const WS = require('ws');
const protobuf = require('protobufjs');
const FormData = require('form-data');
const fs = require('fs');
const definitions = require('./definitions.json');
const List = require('./list');
const Item = require('./item');
const uuid = require('./uuid');
const Recipe = require('./recipe');
const RecipeCollection = require('./recipe-collection');

const CREDENTIALS_FILE = ".anylist_credentials";
const CREDENTIALS_KEY_CLIENT_ID = "clientId";
const CREDENTIALS_KEY_ACCESS_TOKEN = "accessToken";
const CREDENTIALS_KEY_REFRESH_TOKEN = "refreshToken";

const ENDPOINT_FETCH_TOKENS = "auth/token"
const ENDPOINT_REFRESH_TOKENS = "auth/token/refresh"

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
	constructor({email, password}) {
		super();

		this.email = email;
		this.password = password;

		this._loadCredentials()

		this.clientId = this._getClientId();

		this.client = got.extend({
			headers: {
				'X-AnyLeaf-API-Version': '3',
				'X-AnyLeaf-Client-Identifier': this.clientId
			},
			prefixUrl: 'https://www.anylist.com',
			followRedirect: false,
			hooks: {
				beforeRequest: [
					options => {
						const path = this._trimLeadingSlash(options.url.pathname)
						if (path != ENDPOINT_FETCH_TOKENS && path != ENDPOINT_REFRESH_TOKENS) {
							options.headers = {
								'authorization': `Bearer ${this.accessToken}`,
								...options.headers
							};

							if (path.startsWith('data/')) {
								options.responseType = 'buffer';
							}
						}
					}
				],
				afterResponse: [
					async (response, retryWithMergedOptions) => {
						const path = this._trimLeadingSlash(response.request.options.url.pathname);
						console.log("PATH: " + path + "; CODE: " + response.statusCode + "; RETRY: " + response.retryCount);

						//TODO: LIMIT RETRIES

						if (response.statusCode != 401 || path == ENDPOINT_FETCH_TOKENS) {
							return response;
						}

						if (path == ENDPOINT_REFRESH_TOKENS) {
							console.log("RE-FETCHING TOKENS")
							await this._fetchTokens();
						} else {
							console.log("REFRESHING TOKENS")
							await this._refreshTokens();
						}

						const updatedOptions = {
							headers: {
								'authorization': `Bearer ${this.accessToken}`
							}
						};
						this.client.defaults.options.merge(updatedOptions);

						return retryWithMergedOptions(updatedOptions);
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

		const result = await this.client.post(ENDPOINT_FETCH_TOKENS, {
			body: form
		}).json();

		this.accessToken = result.access_token;
		this.refreshToken = result.refresh_token;
		this._storeCredentials();
	}

	async _refreshTokens() {
		const form = new FormData();
		form.append('refresh_token', this.refreshToken);

		const result = await this.client.post(ENDPOINT_REFRESH_TOKENS, {
			body: form
		}).json();

		this.accessToken = result.access_token;
		this.refreshToken = result.refresh_token;
		this._storeCredentials();
	}

	_getClientId() {
		if (this.clientId) {
			return this.clientId;
		}

		console.log("GENERATING NEW CLIENT ID");

		const clientId = uuid();
		this.clientId = clientId;
		this._storeCredentials();
		return clientId;
	}

	_loadCredentials() {
		if (!fs.existsSync(CREDENTIALS_FILE)) {
			return;
		}

		const raw = fs.readFileSync(CREDENTIALS_FILE);
		if (!raw) {
			return;
		}

		const credentials = JSON.parse(raw);
		this.clientId = credentials[CREDENTIALS_KEY_CLIENT_ID];
		this.accessToken = credentials[CREDENTIALS_KEY_ACCESS_TOKEN];
		this.refreshToken = credentials[CREDENTIALS_KEY_REFRESH_TOKEN];
	}

	_storeCredentials() {
		const credentials = {
			[CREDENTIALS_KEY_CLIENT_ID]: this.clientId,
			[CREDENTIALS_KEY_ACCESS_TOKEN]: this.accessToken,
			[CREDENTIALS_KEY_REFRESH_TOKEN]: this.refreshToken
		};
		const raw = JSON.stringify(credentials);
		fs.writeFileSync(CREDENTIALS_FILE, raw);
	}

	_trimLeadingSlash(path) {
		if (path.startsWith("/")) {
			return path.substr(1);
		}

		return path;
	}

	_setupWebSocket() {
		AuthenticatedWebSocket.token = this.accessToken;
		AuthenticatedWebSocket.clientId = this.clientId;

		//TODO: RETRY WEBSOCKET ON 401

		this.ws = new WebSocket(`wss://www.anylist.com/data/add-user-listener`, [], {
			WebSocket: AuthenticatedWebSocket
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
