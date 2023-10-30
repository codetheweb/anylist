const EventEmitter = require('events');
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

		this.clientId = uuid();

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
						const url = options.url.href;
						if (!url.includes("/auth/token")) {
							options.headers = {
								'authorization': `Bearer ${this.token}`,
								'x-anyleaf-client-identifier': this.clientId,
								...options.headers
							};
						}

						if (url.includes('/data/')) {
							options.responseType = 'buffer';
						}
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
		const form = new FormData();
		form.append('email', this.email);
		form.append('password', this.password);

		const result = await this.client.post('auth/token', {
			body: form
		}).json();

		this.uid = result.user_id;
		this.token = result.access_token;

		this._setupWebSocket();
	}

	_setupWebSocket() {
		AuthenticatedWebSocket.token = this.token;
		AuthenticatedWebSocket.clientId = this.clientId;

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
				'x-anyleaf-client-identifier': AuthenticatedWebSocket.clientId
			}
		});
	}
}

module.exports = AnyList;
