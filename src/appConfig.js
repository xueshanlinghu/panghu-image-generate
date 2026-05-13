export const appConfig = {
  providers: [{ id: "panghu", name: "胖狐API", badge: "胖狐API" }],
  models: [
    {
      id: "gpt-image-2",
      providerId: "panghu",
      name: "gpt-image-2",
      capabilities: ["text-to-image"],
      params: {
        size: {
          defaultValue: "auto",
          options: [
            { id: "auto", name: "自动" },
            { id: "1024x1024", name: "1024x1024   1:1 正方形" },
            { id: "1536x1024", name: "1536x1024   3:2 横向" },
            { id: "1024x1536", name: "1024x1536   2:3 竖屏" },
            { id: "2048x2048", name: "2048x2048   1:1 2K 正方形" },
            { id: "2048x1152", name: "2048x1152   16:9 2K 横向" },
            { id: "3840x2160", name: "3840x2160   16:9 4K 横向" },
            { id: "2160x3840", name: "2160x3840   9:16 4K 竖屏" },
          ],
        },
        quality: {
          defaultValue: "auto",
          options: [
            { id: "auto", name: "自动" },
            { id: "low", name: "低" },
            { id: "medium", name: "中" },
            { id: "high", name: "高" },
          ],
        },
      },
    },
  ],
};

export const currentUserId = "local-preview-user";
