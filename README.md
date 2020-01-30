# 📋 AnyList

## a wrapper for AnyList's API (unoffical, reverse engineered)

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

### Notes/Tips

- There is **much** more functionality in the AnyList API that is not captured in this package, I just implimented the functions that I would be using. If there is functionality missing that you want, please open a PR and I'm happy to merge it in.
  - (This means that you can't currently add/remove/update lists.)
- When adding new items, you should reuse existing, checked-off items if possible like the offical clients do. Search the list by the item name with `list.getItemByName('item-name')` to see if it exists before adding a new instance.

### 📖 Docs

[Documentation](https://codetheweb.github.io/anylist/)
