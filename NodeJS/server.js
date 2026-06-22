const app = require("./app");
const { initStore } = require("./store");

const PORT = process.env.PORT || 3000;

initStore(); // create data.json with defaults if it doesn't exist
app.listen(PORT, () => console.log(`Server listening on port ${PORT}`));
