const axios = require("axios");
const config = require("../config");
const ANTHROPIC_URL = "https://api.anthropic.com/v1/messages";
function toUsage(usage = {}){
    const promptTokens = usage.input_tokens || 0;
    const completionTokens = usage.output_tokens || 0;
    const totalTokens = promptTokens + completionTokens;
    return {promptTokens, completionTokens, totalTokens};
}
async function callAnthropic(prompt, model = config.models.reasoning){
    if(!config.anthropicApiKey){
        throw new Error("ANTHROPIC_API_KEY is not configured");
    }
    const start = Date.now();

    try{
    const response = await axios.post(
        ANTHROPIC_URL,
        {
            model,
            max_tokens: 1024,
            messages : [{role: "user", content: prompt}] 
        },
        {
            timeout: config.requestTimeoutMs,
            headers : {
                "x-api-key": config.anthropicApiKey,
                "anthropic-version": "2023-06-01",
                "Content-Type": "application/json"
            }
        }
    );
    const output =
        response?.data?.content?.[0]?.text ||
        "No response";
    return {
        ok: true, 
        output,
        model,
        cost: 0, //TODO: implement Anthropic pricing
        latency: Date.now() - start,
        usage: toUsage(response.data?.usage)
    };
    } catch(error) {
        return {
            ok: false,
            error: error.message,
            model,
            cost: 0,
            latency: Date.now() - start,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 }
        };
    }
}
module.exports = callAnthropic;