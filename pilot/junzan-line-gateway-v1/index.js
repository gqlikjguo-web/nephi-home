"use strict";

const { createGateway } = require("./gateway");
const port = Number(process.env.PORT || 10000);
createGateway().listen(port, "0.0.0.0", () => console.log(JSON.stringify({ scope: "junzan-line-gateway", event: "listening", port })));
