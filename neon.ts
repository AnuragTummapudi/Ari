import { defineConfig } from "@neon/config/v1";

export default defineConfig({
  auth: true,
  preview: {
    buckets: {
      resumes: { access: "public_read" },
      "candidate-resumes": { access: "private" },
    },
    functions: {
      api: { name: "api", source: "./hello.ts" },
    },
  },
});
