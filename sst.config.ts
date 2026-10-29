/// <reference path="./.sst/platform/config.d.ts" />

export default $config({
  app(input) {
    return {
      name: "smflw-interview",
      home: "aws",
      removal: input.stage === "production" ? "retain" : "remove",
      protect: input.stage === "production",
      providers: { aws: { region: "eu-central-1" } },
    };
  },
  async run() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_PUBLISHABLE_KEY;
    if (!supabaseUrl || !supabaseKey || supabaseKey.startsWith("replace-")) {
      throw new Error("Set SUPABASE_URL and SUPABASE_PUBLISHABLE_KEY in .env (see .env.example)");
    }

    const images = new sst.aws.Bucket("Images", {
      cors: { allowOrigins: ["*"], allowMethods: ["POST"], allowHeaders: ["*"] },
      lifecycle: [{ id: "expire-uploads", prefix: "uploads/", expiresIn: "1 day" }],
    });
    const anthropicKey = new sst.Secret("AnthropicApiKey");
    const supabaseServiceKey = new sst.Secret("SupabaseServiceKey");
    const cleanupQueue = new sst.aws.Queue("AccountCleanup", {
      delay: "6 minutes",
      visibilityTimeout: "12 minutes",
    });
    const objectResources = [
      $interpolate`${images.arn}/uploads/*`,
      $interpolate`${images.arn}/certificates/*`,
    ];
    const accountEnvironment = {
      IMAGE_BUCKET: images.name,
      S3_ENDPOINT_URL: "",
      SUPABASE_URL: supabaseUrl,
      SUPABASE_PUBLISHABLE_KEY: supabaseKey,
      SUPABASE_SERVICE_KEY: supabaseServiceKey.value,
    };
    cleanupQueue.subscribe({
      handler: "backend/src/smflw_api/privacy.reap_handler",
      runtime: "python3.13",
      copyFiles: [{ from: "backend/src/smflw_api", to: "smflw_api" }],
      architecture: "arm64",
      memory: "512 MB",
      timeout: "120 seconds",
      permissions: [
        { actions: ["s3:ListBucket"], resources: [images.arn] },
        { actions: ["s3:GetObject", "s3:DeleteObject"], resources: objectResources },
      ],
      environment: accountEnvironment,
    });

    const api = new sst.aws.Function("Api", {
      handler: "backend/src/smflw_api/main.handler",
      runtime: "python3.13",
      // SST retains source paths; expose the uv package for absolute imports.
      copyFiles: [{ from: "backend/src/smflw_api", to: "smflw_api" }],
      architecture: "arm64",
      memory: "512 MB",
      timeout: "60 seconds",
      permissions: [
        { actions: ["s3:GetObject", "s3:PutObject", "s3:DeleteObject"], resources: objectResources },
        { actions: ["s3:ListBucket"], resources: [images.arn] },
        { actions: ["sqs:SendMessage"], resources: [cleanupQueue.arn] },
      ],
      url: {
        cors: {
          allowOrigins: ["*"],
          allowMethods: ["GET", "POST", "PUT", "PATCH", "DELETE"],
          allowHeaders: ["authorization", "content-type"],
        },
      },
      environment: {
        ...accountEnvironment,
        CLEANUP_QUEUE_URL: cleanupQueue.url,
        PUBLIC_WEB_URL: process.env.DEPLOYED_WEB_URL ?? "https://d37vhte4c7hh1c.cloudfront.net",
        S3_ENDPOINT_URL: "",
        ANTHROPIC_API_KEY: anthropicKey.value,
        ANTHROPIC_MODEL: process.env.ANTHROPIC_MODEL ?? "claude-haiku-5-5",
        ANTHROPIC_SONNET_MODEL: process.env.ANTHROPIC_SONNET_MODEL ?? "claude-sonnet-5-5",
        SUPABASE_URL: supabaseUrl,
        SUPABASE_PUBLISHABLE_KEY: supabaseKey,
      },
    });

    const web = new sst.aws.StaticSite("Web", {
      path: "frontend",
      build: { command: "npm run build", output: "dist" },
      environment: {
        VITE_API_URL: api.url,
        VITE_SUPABASE_URL: supabaseUrl,
        VITE_SUPABASE_PUBLISHABLE_KEY: supabaseKey,
      },
    });

    return { api: api.url, web: web.url, images: images.name };
  },
});
