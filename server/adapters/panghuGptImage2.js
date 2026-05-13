const adapterId = "panghu:gpt-image-2";

export const panghuGptImage2Adapter = {
  id: adapterId,
  providerId: "panghu",
  model: "gpt-image-2",

  isMatch({ providerId, model }) {
    return providerId === this.providerId && model === this.model;
  },

  assertConfigured() {
    if (!process.env.PANGHU_API_KEY) {
      throw new Error("PANGHU_API_KEY is not configured.");
    }
    if (!process.env.PANGHU_API_BASE_URL) {
      throw new Error("PANGHU_API_BASE_URL is not configured.");
    }
  },

  buildRequest(input) {
    const body = {
      model: this.model,
      prompt: input.prompt.trim(),
    };

    if (input.size && input.size !== "auto") body.size = input.size;
    if (input.quality && input.quality !== "auto") body.quality = input.quality;

    return {
      url: `${process.env.PANGHU_API_BASE_URL.replace(/\/$/, "")}/v1/images/generations`,
      options: {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${process.env.PANGHU_API_KEY}`,
        },
        body: JSON.stringify(body),
      },
    };
  },

  parseResponse(payload) {
    const first = payload?.data?.[0] || payload?.images?.[0] || payload;
    const imageUrl = first?.url || first?.image_url || first?.output_url;
    const b64 = first?.b64_json || first?.base64 || first?.image_base64;

    if (!imageUrl && !b64) {
      throw new Error("The image API did not return a supported image payload.");
    }

    return {
      model: payload?.model || this.model,
      imageUrl: imageUrl || `data:image/png;base64,${b64}`,
      originalImageUrl: imageUrl || null,
      revisedPrompt: first?.revised_prompt || payload?.revised_prompt || null,
      usage: payload?.usage || null,
      raw: payload,
    };
  },
};
