require("dotenv").config();
const { GoogleGenerativeAI } = require("@google/generative-ai");

const genAI = new GoogleGenerativeAI(process.env.GOOGLE_API_KEY);

async function listModels() {
  const models = await genAI.listModels();
  models.forEach(m => console.log(m.name));
}

listModels();