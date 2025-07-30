/*
|--------------------------------------------------------------------------
| Environment variables service
|--------------------------------------------------------------------------
|
| The `Env.create` method creates an instance of the Env service. The
| service validates the environment variables and also cast values
| to JavaScript data types.
|
*/

import { Env } from '@adonisjs/core/env'

export default await Env.create(new URL('../', import.meta.url), {
  NODE_ENV: Env.schema.enum(['development', 'production', 'test'] as const),
  PORT: Env.schema.number(),
  APP_KEY: Env.schema.string(),
  HOST: Env.schema.string({ format: 'host' }),
  LOG_LEVEL: Env.schema.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']),

  /*
  |----------------------------------------------------------
  | Variables for configuring database connection
  |----------------------------------------------------------
  */
  DB_HOST: Env.schema.string(),
  DB_PORT: Env.schema.number(),
  DB_USER: Env.schema.string(),
  DB_PASSWORD: Env.schema.string.optional(),
  DB_DATABASE: Env.schema.string(),

  /*
  |----------------------------------------------------------
  | Variables for configuring Redis connection
  |----------------------------------------------------------
  */
  REDIS_HOST: Env.schema.string(),
  REDIS_PORT: Env.schema.number(),
  REDIS_PASSWORD: Env.schema.string.optional(),
  REDIS_DB: Env.schema.number(),

  /*
  |----------------------------------------------------------
  | Variables for configuring ImgProxy
  |----------------------------------------------------------
  */
  IMGPROXY_BASE_URL: Env.schema.string.optional(),
  IMGPROXY_KEY: Env.schema.string.optional(),
  IMGPROXY_SALT: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring drive storage
  |----------------------------------------------------------
  */
  DRIVE_DISK: Env.schema.enum(['fs', 'r2'] as const),
  DRIVE_LOCAL_PATH: Env.schema.string.optional(),
  DRIVE_BASE_URL: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring Cloudflare R2
  |----------------------------------------------------------
  */
  R2_KEY: Env.schema.string(),
  R2_SECRET: Env.schema.string(),
  R2_BUCKET: Env.schema.string(),
  R2_ENDPOINT: Env.schema.string(),
  R2_REGION: Env.schema.string.optional(),
  R2_PUBLIC_URL: Env.schema.string.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring screenshot system
  |----------------------------------------------------------
  */
  SCREENSHOT_TIMEOUT: Env.schema.number(),
  SCREENSHOT_CACHE_TTL: Env.schema.number(),
  SCREENSHOT_MAX_CONCURRENT: Env.schema.number(),
  SCREENSHOT_QUEUE_CONCURRENCY: Env.schema.number(),
  SCREENSHOT_CLEANUP_INTERVAL: Env.schema.number.optional(),
  SCREENSHOT_MAX_AGE_DAYS: Env.schema.number.optional(),
  SCREENSHOT_QUEUE_REMOVE_ON_COMPLETE: Env.schema.number.optional(),
  SCREENSHOT_QUEUE_REMOVE_ON_FAIL: Env.schema.number.optional(),

  /*
  |----------------------------------------------------------
  | Variables for configuring browser
  |----------------------------------------------------------
  */
  BROWSER_HEADLESS: Env.schema.boolean(),
  BROWSER_TIMEOUT: Env.schema.number(),
})
