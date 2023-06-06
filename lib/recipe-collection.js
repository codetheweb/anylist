const FormData = require('form-data');
const uuid = require('./uuid');

/**
 * RecipeCollection class.
 * @class
 *
 * @param {object} recipeCollection recipeCollection
 * @param {object} context context
 *
 * @property {string} identifier
 * @property {string} timestamp
 * @property {string} name
 * @property {string[]} recipeIds
 * @property {string[]} preparationSteps
 * @property {string[]} photoIds
 * @property {string} adCampaignId
 * @property {string[]} photoUrls
 * @property {double} scaleFactor
 * @property {int} rating
 * @property {string} creationTimestamp
 * @property {string} nutritionalInfo
 * @property {int} cookTime
 * @property {int} prepTime
 * @property {string} servings
 * @property {string} paprikaIdentifier
 */
class RecipeCollection {
	/**
   * @hideconstructor
   */
	constructor(recipeCollection, {client, protobuf, uid, recipeDataId}) {
		this._client = client;
		this.protobuf = protobuf;
		this.uid = uid;
		this.recipeDataId = recipeDataId;

		this.identifier = recipeCollection.identifier || uuid();
		this.timestamp = recipeCollection.timestamp || Date.now() / 1000;
		this.name = recipeCollection.name;
		this.recipeIds = recipeCollection.recipeIds ? recipeCollection.recipeIds : [];
		this.collectionSettings = recipeCollection.collectionSettings ? recipeCollection.collectionSettings : new this.protobuf.PBRecipeCollectionSettings();
	}

	_encode() {
		return new this.protobuf.PBRecipeCollection({
			identifier: this.identifier,
			timestamp: this.timestamp,
			name: this.name,
			recipeIds: this.recipeIds,
			collectionSettings: this.collectionSettings
		});
	}

	/**
   * Perform a recipe operation.
   * @private
   * @param {string} handlerId - Handler ID for the operation
   * @returns {Promise} - Promise representing the operation result
   */
	async performOperation(handlerId) {
		const ops = new this.protobuf.PBRecipeOperationList();
		const op = new this.protobuf.PBRecipeOperation();
		op.setMetadata({
			operationId: uuid(),
			handlerId,
			userId: this.uid
		});

		// May not need recipedataid
		op.setRecipeDataId(this.recipeDataId);
		op.setRecipeCollection(this._encode());
		ops.setOperations(op);

		const form = new FormData();
		form.append('operations', ops.toBuffer());

		await this._client.post('data/user-recipe-data/update', {
			body: form
		});
	}

	/**
		  * Save local changes to recipe to AnyList's API.
		  * @return {Promise}
		  */
	async save() {
		await this.performOperation('new-recipe-collection');
	}

	/**
		  * Delete a recipe collection from AnyList.
		  * @return {Promise}
		  */
	async delete() {
		await this.performOperation('remove-recipe-collection');
	}

	/**
		  * Adds an existing recipe to an existing recipe-collection on AnyList.
		  * @return {Promise}
		  */
	async addRecipe(recipeId) {
		if (recipeId) {
			this.recipeIds.push(recipeId);
			await this.performOperation('add-recipes-to-collection');
		}
	}

	/**
		  * Remove existing recipe from an existing recipe-collection on AnyList.
		  * @return {Promise}
		  */
	async removeRecipe(recipeId) {
		const recipeIdPos = this.recipeIds.indexOf(recipeId);
		if (recipeIdPos > -1) {
			await this.performOperation('remove-recipes-from-collection');
			this.recipeIds.splice(recipeIdPos, 1);
		}
	}
}
module.exports = RecipeCollection;
