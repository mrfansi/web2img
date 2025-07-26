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
            
            /* Add loading indicator */
            .loading {
                display: flex;
                justify-content: center;
                align-items: center;
                height: 50vh;
                font-family: Arial, sans-serif;
                color: #666;
            }
            
            .loading::after {
                content: 'Loading API Documentation...';
            }
        </style>
        </head>
        <body>
        <div id="swagger-ui"><div class="loading"></div></div>
        <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-bundle.js"></script>
        <script src="https://unpkg.com/swagger-ui-dist@5.9.0/swagger-ui-standalone-preset.js"></script>
        <script>
            window.onload = function() {
            // Get the current origin to ensure we use the correct server URL
            const currentOrigin = window.location.origin;
            
            try {
                SwaggerUIBundle({
                    url: currentOrigin + '/docs/openapi.json',
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
                    showCommonExtensions: true,
                    onComplete: function() {
                        console.log('Swagger UI loaded successfully');
                    },
                    onFailure: function(error) {
                        console.error('Swagger UI failed to load:', error);
                        document.getElementById('swagger-ui').innerHTML = 
                            '<div style="padding: 20px; text-align: center; color: #d32f2f;">' +
                            '<h2>Failed to Load API Documentation</h2>' +
                            '<p>Error: ' + (error.message || 'Unknown error') + '</p>' +
                            '<p>Please try refreshing the page or contact support.</p>' +
                            '</div>';
                    }
                });
            } catch (error) {
                console.error('Error initializing Swagger UI:', error);
                document.getElementById('swagger-ui').innerHTML = 
                    '<div style="padding: 20px; text-align: center; color: #d32f2f;">' +
                    '<h2>Failed to Initialize API Documentation</h2>' +
                    '<p>Error: ' + error.message + '</p>' +
                    '<p>Please try refreshing the page or contact support.</p>' +
                    '</div>';
            }
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
    async spec({ request, response }: HttpContext) {
        const spec = swaggerService.getSpec()

        // Update the server URL to match the current request
        const protocol = request.header('x-forwarded-proto') || request.protocol()
        const host = request.header('host') || 'localhost:3333'
        const currentServerUrl = `${protocol}://${host}`

        // Clone the spec and update server URLs to include current server
        const updatedSpec = {
            ...spec,
            servers: [
                {
                    url: currentServerUrl,
                    description: 'Current server'
                },
                ...(spec.servers || [])
            ]
        }

        response.header('Content-Type', 'application/json')
        return updatedSpec
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
        return response.redirect('/docs')
    }
}
