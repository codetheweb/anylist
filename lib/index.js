const EventEmitter = require('events');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const {Buffer} = require('buffer');
const got = require('got');
const WebSocket = require('reconnecting-websocket');
const WS = require('ws');
const protobuf = require('protobufjs');
const FormData = require('form-data');
const definitions = require('./definitions.json');
const List = require('./list');
const Item = require('./item');
const uuid = require('./uuid');
const Recipe = require('./recipe');
const RecipeCollection = require('./recipe-collection');
const MealPlanningCalendarEvent = require('./meal-planning-calendar-event');
const MealPlanningCalendarEventLabel = require('./meal-planning-calendar-label');

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
 * @param {string} options.credentialsFile file path for credentials storage file
 *
 * @property {List[]} lists
 * @property {Object.<string, Item[]>} recentItems
 * @property {List[]} favoriteItems
 * @property {Recipe[]} recipes
 * @fires AnyList#lists-update
 */
class AnyList extends EventEmitter {
	constructor({email, password, credentialsFile = path.join(os.homedir(), '.anylist_credentials')}) {
		super();

		this.email = email;
		this.password = password;
		this.credentialsFile = credentialsFile;

		this.authClient = got.extend({
			headers: {
				'X-AnyLeaf-API-Version': '3',
			},
			prefixUrl: 'https://www.anylist.com',
			followRedirect: false,
			hooks: {
				beforeError: [
					error => {
						const {response} = error;
						const url = response.request.options.url.href;
						console.error(`Endpoint ${url} returned uncaught status code ${response.statusCode}`);
						return error;
					},
				],
			},
		});

		this.client = this.authClient.extend({
			mutableDefaults: true,
			hooks: {
				beforeRequest: [
					options => {
						options.headers = {
							'X-AnyLeaf-Client-Identifier': this.clientId,
							authorization: `Bearer ${this.accessToken}`,
							...options.headers,
						};

						const path = options.url.pathname;
						if (path.startsWith('/data/')) {
							options.responseType = 'buffer';
						}
					},
				],
				afterResponse: [
					async (response, retryWithMergedOptions) => {
						if (response.statusCode !== 401) {
							return response;
						}

						const url = response.request.options.url.href;
						console.info(`Endpoint ${url} returned status code 401, refreshing access token before retrying`);

						await this._refreshTokens();
						return retryWithMergedOptions({
							headers: {
								authorization: `Bearer ${this.accessToken}`,
							},
						});
					},
				],
				beforeError: [
					error => {
						const {response} = error;
						const url = response.request.options.url.href;
						console.error(`Endpoint ${url} returned uncaught status code ${response.statusCode}`);
						return error;
					},
				],
			},
		});

		this.protobuf = protobuf.newBuilder({}).import(definitions).build('pcov.proto');

		this.lists = [];
		this.favoriteItems = [];
		this.recentItems = {};
		this.recipes = [];
		this.recipeDataId = null;
		this._userData = null;
		this.calendarId = null;
	}

	/**
   * Log into the AnyList account provided
   * in the constructor.
   */
	async login(connectWebSocket = true) {
		await this._loadCredentials();
		this.clientId = await this._getClientId();

		if (!this.accessToken || !this.refreshToken) {
			console.info('No saved tokens found, fetching new tokens using credentials');
			await this._fetchTokens();
		}

		if (connectWebSocket) {
			this._setupWebSocket();
		}
	}

	async _fetchTokens() {
		const form = new FormData();
		form.append('email', this.email);
		form.append('password', this.password);

		const result = await this.authClient.post('auth/token', {
			body: form,
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
				body: form,
			}).json();

			this.accessToken = result.access_token;
			this.refreshToken = result.refresh_token;
			await this._storeCredentials();
		} catch (error) {
			if (error.response.statusCode !== 401) {
				throw error;
			}

			console.info('Failed to refresh access token, fetching new tokens using credentials');
			await this._fetchTokens();
		}
	}

	async _getClientId() {
		if (this.clientId) {
			return this.clientId;
		}

		console.info('No saved clientId found, generating new clientId');

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
			console.info('Credentials file does not exist, not loading saved credentials');
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
			[CREDENTIALS_KEY_REFRESH_TOKEN]: this.refreshToken,
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
		const key = crypto.createHash('sha256').update(String(secret)).digest('base64').slice(0, 32);
		const iv = crypto.randomBytes(16);
		const cipher = crypto.createCipheriv('aes-256-cbc', Buffer.from(key), iv);
		let encrypted = cipher.update(plain);
		encrypted = Buffer.concat([encrypted, cipher.final()]);
		return JSON.stringify({
			iv: iv.toString('hex'),
			cipher: encrypted.toString('hex'),
		});
	}

	_decryptCredentials(credentials, secret) {
		const encrypted = JSON.parse(credentials);
		const key = crypto.createHash('sha256').update(String(secret)).digest('base64').slice(0, 32);
		const decipher = crypto.createDecipheriv('aes-256-cbc', Buffer.from(key), Buffer.from(encrypted.iv, 'hex'));
		let plain = decipher.update(Buffer.from(encrypted.cipher, 'hex'));
		plain = Buffer.concat([plain, decipher.final()]);
		return JSON.parse(plain.toString());
	}

	_setupWebSocket() {
		AuthenticatedWebSocket.token = this.accessToken;
		AuthenticatedWebSocket.clientId = this.clientId;

		this.ws = new WebSocket('wss://www.anylist.com/data/add-user-listener', [], {
			WebSocket: AuthenticatedWebSocket,
			maxReconnectAttempts: 2,
		});

		this.ws.addEventListener('open', () => {
			console.info('Connected to websocket');
			this._heartbeatPing = setInterval(() => {
				this.ws.send('--heartbeat--');
			}, 5000); // Web app heartbeats every 5 seconds
		});

		this.ws.addEventListener('message', async ({data}) => {
			if (data === 'refresh-shopping-lists') {
				console.info('Refreshing shopping lists');

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

		// eslint-disable-next-line arrow-parens
		this.ws.addEventListener('error', async (error) => {
			console.error(`Disconnected from websocket: ${error.message}`);
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
		if (this.ws !== undefined) {
			this.ws.close();
		}
	}

	/**
   * Load all lists from account into memory.
   * @return {Promise<List[]>} lists
   */
	async getLists(refreshCache = true) {
		const decoded = await this._getUserData(refreshCache);

		this.lists = decoded.shoppingListsResponse.newLists.map(list => new List(list, this));

		for (const response of decoded.starterListsResponse.recentItemListsResponse.listResponses) {
			const list = response.starterList;
			this.recentItems[list.listId] = list.items.map(item => new Item(item, this));
		}

		const favoriteLists = decoded.starterListsResponse.favoriteItemListsResponse.listResponses.map(
			object => object.starterList,
		);

		this.favoriteItems = favoriteLists.map(
			list => new List(list, this),
		);

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
	* Get favorite items for a list.
	* @param {string} identifier list identifier
	* @return {List} favorites items array
	*/
	getFavoriteItemsByListId(identifier) {
		return this.favoriteItems.find(l => l.parentId === identifier);
	}

	/**
   * Load all meal planning calendar events from account into memory.
   * @return {Promise<MealPlanningCalendarEvent[]>} events
   */
	async getMealPlanningCalendarEvents(refreshCache = true) {
		const decoded = await this._getUserData(refreshCache);

		this.mealPlanningCalendarEvents = decoded.mealPlanningCalendarResponse.events.map(event => new MealPlanningCalendarEvent(event, this));

		// Map and assign labels
		this.mealPlanningCalendarEventLabels = decoded.mealPlanningCalendarResponse.labels.map(label => new MealPlanningCalendarEventLabel(label));
		for (const event of this.mealPlanningCalendarEvents) {
			event.label = this.mealPlanningCalendarEventLabels.find(label => label.identifier === event.labelId);
		}

		// Map and assign recipies
		this.recipes = decoded.recipeDataResponse.recipes.map(recipe => new Recipe(recipe, this));
		for (const event of this.mealPlanningCalendarEvents) {
			event.recipe = this.recipes.find(recipe => recipe.identifier === event.recipeId);
		}

		return this.mealPlanningCalendarEvents;
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
	 * Factory function to create a new MealPlanningCalendarEvent.
	 * @param {object} event new calendar event options.
	 * @return {MealPlanningCalendarEvent} event
	 */
	async createEvent(eventObject) {
		if (!this.calendarId) {
			await this._getUserData();
		}

		return new MealPlanningCalendarEvent(eventObject, this);
	}

	/**
   * Load all recipes from account into memory.
   * @return {Promise<Recipe[]>} recipes
	*/
	async getRecipes(refreshCache = true) {
		const decoded = await this._getUserData(refreshCache);

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

	async _getUserData(refreshCache) {
		if (!this._userData || refreshCache) {
			const result = await this.client.post('data/user-data/get');
			this._userData = this.protobuf.PBUserDataResponse.decode(result.body);
			this.calendarId = this._userData.mealPlanningCalendarResponse.calendarId;
		}

		return this._userData;
	}
}

class AuthenticatedWebSocket extends WS {
	static token;
	static clientId;

	constructor(url, protocols) {
		super(url, protocols, {
			headers: {
				authorization: `Bearer ${AuthenticatedWebSocket.token}`,
				'x-anyleaf-client-identifier': AuthenticatedWebSocket.clientId,
				'X-AnyLeaf-API-Version': '3',
			},
		});
	}
}

module.exports = AnyList;
