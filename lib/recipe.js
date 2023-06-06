const FormData = require('form-data');
const Ingredient = require('./ingredient');
const uuid = require('./uuid');

/**
 * Recipe class.
 * @class
 *
 * @param {object} recipe recipe
 * @param {object} context context
 *
 * @property {string} identifier
 * @property {string} timestamp
 * @property {string} name
 * @property {string} note
 * @property {string} sourceName
 * @property {string} sourceUrl
 * @property {Ingredient[]} ingredients
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
class Recipe {
	/**
   * @hideconstructor
   */
	constructor(recipe, {client, protobuf, uid, recipeDataId}) {
		this.identifier = recipe.identifier || uuid();
		this.timestamp = recipe.timestamp || Date.now()/1000;
		this.name = recipe.name;
		this.note = recipe.note;
		this.sourceName = recipe.sourceName;
		this.sourceUrl = recipe.sourceUrl;
		this.ingredients = recipe.ingredients ? recipe.ingredients.map(i => new Ingredient(i, {client, protobuf, uid})) : [];
		this.preparationSteps = recipe.preparationSteps ? recipe.preparationSteps : [];
		this.photoIds = recipe.photoIds ? recipe.photoIds : [];
		this.photoUrls = recipe.photoUrls ? recipe.photoUrls : [];
		this.adCampaignId = recipe.adCampaignId;
		this.scaleFactor = recipe.scaleFactor;
		this.rating = recipe.rating;
		this.creationTimestamp = recipe.creationTimestamp;
		this.nutritionalInfo = recipe.nutritionalInfo;
		this.cookTime = recipe.cookTime;
		this.prepTime = recipe.prepTime;
		this.servings = recipe.servings;
		this.paprikaIdentifier = recipe.paprikaIdentifier;

		this._client = client;
		this.protobuf = protobuf;
		this.uid = uid;
		this.recipeDataId = recipeDataId;
	}

	_encode() {
		return new this.protobuf.PBRecipe({
			identifier: this.identifier,
			timestamp: this.timestamp,
			name: this.name,
			note: this.note,
			sourceName: this.sourceName,
			sourceUrl: this.sourceUrl,
			ingredients : this.ingredients.map(x => x._encode()),
			preparationSteps : this.preparationSteps,
			photoIds: this.photoIds,
			adCampaignId: this.adCampaignId,
			photoUrls: this.photoUrls,
			scaleFactor: this.scaleFactor,
			rating: this.rating,
			creationTimestamp: this.creationTimestamp,
			nutritionalInfo: this.nutritionalInfo,
			cookTime: this.cookTime,
			prepTime: this.prepTime,
			servings: this.servings,
			paprikaIdentifier: this.paprikaIdentifier
		});
	}

	/**
   * Perform a recipe operation.
   * @private
   * @param {string} handlerId - Handler ID for the operation
   * @returns {Promise} - Promise representing the operation result
   */
	async performOperation(handlerId)
	{
		const ops = new this.protobuf.PBRecipeOperationList();
		const op = new this.protobuf.PBRecipeOperation();
		op.setMetadata({
		  operationId: uuid(),
		  handlerId: handlerId,
		  userId: this.uid,
		});
		op.setRecipeDataId(this.recipeDataId);
		op.setRecipe(this._encode());
		op.setRecipeIds(this.recipeDataId);
		ops.setOperations(op);
	
		const form = new FormData();
		form.append('operations', ops.toBuffer());
		
		const result = await this._client.post('data/user-recipe-data/update', {
		  body: form,
		});
	}
	/**
   	* Save local changes to recipe to AnyList's API.
   	* @return {Promise}
   	*/
	async save() {
		await this.performOperation('save-recipe');
	}
	
	/**
   	* Delete local changes to recipe to AnyList's API.
   	* @return {Promise}
   	*/
	   async delete() {
		await this.performOperation('remove-recipe');
	}
}
module.exports = Recipe;
