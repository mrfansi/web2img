import type { HttpContext } from '@adonisjs/core/http'
import swaggerService from '#services/swagger_service'

/**
 * Controller for serving OpenAPI/Swagger documentation
 */
export default class SwaggerController {
    /**
     * Serve the Swagger UI interface
     * GET /docs
     */
    async ui({ response }: HttpContext) {
        // Return HTML directly with the Swagger UI
        const html = `
        <!DOCTYPE html>
        <html lang="en">
        <head>
        <meta charset="UTF-8">
        <title>Web2Img API Documentation</title>
        <link rel="stylesheet" type="text/css" href="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui.css" />
        <link rel="icon" type="image/png" href="https://unpkg.com/swagger-ui-dist@5.9.0/favicon-32x32.png" sizes="32x32" />
        <style>
            html {
            box-sizing: border-box;
            overflow: -moz-scrollbars-vertical;
            overflow-y: scroll;
            }
            *, *:before, *:after {
            box-sizing: inherit;
            }
            body {
            margin:0;
            background: #fafafa;
            }
            .swagger-ui .topbar { display: none }
            .swagger-ui .info .title { color: #3b82f6 }
        </style>
        </head>
        <body>
        <div id="swagger-ui"></div>
        <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-bundle.js"></script>
        <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-standalone-preset.js"></script>
        <script>
            window.onload = function() {
            SwaggerUIBundle({
                url: '/api-docs/openapi.json',
                dom_id: '#swagger-ui',
                deepLinking: true,
                presets: [
                SwaggerUIBundle.presets.apis,
                SwaggerUIStandalonePreset
                ],
                plugins: [
                SwaggerUIBundle.plugins.DownloadUrl
                ],
                layout: "StandaloneLayout",
                tryItOutEnabled: true,
                filter: true,
                persistAuthorization: true,
                displayRequestDuration: true,
                docExpansion: 'list',
                defaultModelsExpandDepth: 2,
                showExtensions: true,
                showCommonExtensions: true
            })
            }
        </script>
        </body>
        </html>
        `

        response.header('Content-Type', 'text/html')
        return html
    }

    /**
     * Serve the OpenAPI JSON specification
     * GET /docs/openapi.json
     */
    async spec({ response }: HttpContext) {
        const spec = swaggerService.getSpec()
        response.header('Content-Type', 'application/json')
        return spec
    }

    /**
     * Serve a pretty-printed JSON version of the spec
     * GET /docs/openapi
     */
    async specPretty({ response }: HttpContext) {
        const specJson = swaggerService.getSpecJson()
        response.header('Content-Type', 'application/json')
        return specJson
    }

    /**
     * Redirect root docs URL to the UI
     * GET /api-docs/
     */
    async redirect({ response }: HttpContext) {
        return response.redirect('/api-docs')
    }
}
