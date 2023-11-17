# 📋 AnyList

![node-current](https://img.shields.io/node/v/anylist)

## a wrapper for AnyList's API (unofficial, reverse engineered)

### Install

`npm i anylist`

### Getting Started

Here's an example script (replace `email` and `password` with your credentials):

```javascript
const AnyList = require('anylist');

const any = new AnyList({email: 'hi@here.com', password: 'password'});

any.on('lists-update', lists => {
  console.log('Lists were updated!');
});

any.login().then(async () => {
  await any.getLists();

  // Add new item to the Walmart list
  const walmart = any.getListByName('Walmart');

  let chips = any.createItem({name: 'Chips'});

  chips = await walmart.addItem(chips)

  // Check off added item
  chips.checked = true;
  // And change the quantity
  chips.quantity = '2';
  // Save updated item
  await chips.save();

  // Delete item
  await walmart.removeItem(chips);

  any.teardown();
});
```

### Getting Started with Recipes

```javascript
const AnyList = require('anylist');

const any = new AnyList({email: 'hi@here.com', password: 'password'});

any.login().then(async () => {
    const recipeName = 'Congee recipe';
    const testRecipe = await any.createRecipe(
        {
            name: recipeName,
            note: 'this is a test note',
            preparationSteps: ['# heading 1', 'this is preparation step 1'],
            servings: '2 servings as main dish',
            sourceName: 'serious eats',
            sourceUrl: 'https://seriouseats.com',
            scaleFactor: 1,
            rating: 5,
            ingredients: [{
                rawIngredient: '1 garlic, chopped',
                name: 'garlic',
                quantity: '1',
                note: 'chopped'
            }],
            nutritionalInfo: 'this is nutritional info',
            cookTime: 5 * 60, // seconds
            prepTime: 5 * 60, // seconds
            creationTimestamp: Date.now() / 1000,
            timestamp: Date.now() / 1000
        }
    );


    // Save test recipe
    await testRecipe.save();

    const collection = any.createRecipeCollection({ name: 'ONLINE RECIPES' })

    await collection.save();

    await collection.addRecipe(testRecipe.identifier);

    await collection.removeRecipe(testRecipe.identifier);

    // clean up / delete test recipe collection
    await collection.delete();

    // cleanup / delete test recipe
    await testRecipe.delete();


    any.teardown();
});
```


### Persistent Credentials Storage
By default, the client ID and authentications tokens are encrypted with AES-256 encryption using your account password and then stored to disk. The default storage location is the `.anylist_credentials` file in the user home directory. If you wish to change the storage location, set the `credentialsFile` parameter of the `AnyList` constructor to the desired path. If you wish to disable persistent credentials storage, set the `credentialsFile` parameter to `null`.


### Notes/Tips

- There is **much** more functionality in the AnyList API that is not captured in this package, I just implemented the functions that I would be using. If there is functionality missing that you want, please open a PR and I'm happy to merge it in.
  - (This means that you can't currently add/remove/update lists.)
- When adding new items, you should reuse existing, checked-off items if possible like the official clients do. Search the list by the item name with `list.getItemByName('item-name')` to see if it exists before adding a new instance.

### 📖 Docs

[Documentation](https://codetheweb.github.io/anylist/)
