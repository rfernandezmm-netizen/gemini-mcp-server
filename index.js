import express from 'express';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const app = express();
app.use(express.json());

// 1. Inicializar el Servidor MCP básico
const mcpServer = new Server(
  {
    name: "gemini-imagen-server",
    version: "1.0.0",
  },
  {
    capabilities: {
      tools: {},
    },
  }
);

// 2. Registrar la herramienta de imágenes para Claude
mcpServer.setRequestHandler(ListToolsRequestSchema, async () => {
  return {
    tools: [
      {
        name: "generar_imagen_gemini",
        description: "Genera imágenes realistas, artísticas o conceptuales de alta calidad usando Google Imagen 3.",
        inputSchema: {
          type: "object",
          properties: {
            prompt: {
              type: "string",
              description: "Descripción detallada en inglés o español de la imagen que se desea generar.",
            },
            aspectRatio: {
              type: "string",
              description: "Relación de aspecto de la imagen.",
              enum: ["1:1", "3:4", "4:3", "16:9"],
              default: "1:1"
            }
          },
          required: ["prompt"],
        },
      },
    ],
  };
});

// 3. Ejecutar la lógica de generación cuando Claude invoque la herramienta
mcpServer.setRequestHandler(CallToolRequestSchema, async (request) => {
  if (request.params.name !== "generar_imagen_gemini") {
    throw new Error("Herramienta no encontrada");
  }

  const { prompt, aspectRatio = "1:1" } = request.params.arguments;
  const apiKey = process.env.GEMINI_API_KEY;

  if (!apiKey) {
    return {
      content: [{ type: "text", text: "Error: La variable de entorno GEMINI_API_KEY no está configurada." }],
      isError: true,
    };
  }

  try {
    const url = `https://googleapis.com{apiKey}`;
    
    const response = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        prompt: prompt,
        numberOfImages: 1,
        aspectRatio: aspectRatio,
        outputMimeType: "image/jpeg"
      })
    });

    if (!response.ok) {
      const errorData = await response.json();
      throw new Error(errorData.error?.message || "Error en la API de Google");
    }

    const data = await response.json();
    const base64Image = data.generatedImages.image.imageBytes;

    return {
      content: [
        { type: "text", text: `Imagen generada con éxito para el prompt: "${prompt}"` },
        { type: "image", data: base64Image, mimeType: "image/jpeg" }
      ],
    };

  } catch (error) {
    return {
      content: [{ type: "text", text: `Error al generar la imagen: ${error.message}` }],
      isError: true,
    };
  }
});

// 4. NUEVO ENDPOINT: Ruta unificada Streamable HTTP compatible con Vercel Serverless
app.all('/mcp', async (req, res) => {
  // Manejo de la conexión bidireccional continua por HTTP chunked encoding
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Transfer-Encoding', 'chunked');

  const transport = {
    async start() {
      // Maneja la entrada de datos del cliente hacia el servidor MCP
      req.on('data', (chunk) => this.onMessage?.(JSON.parse(chunk.toString())));
    },
    async send(message) {
      // Devuelve la respuesta del servidor hacia Claude de inmediato
      res.write(JSON.stringify(message) + '\n');
    },
    async close() {
      res.end();
    }
  };

  await mcpServer.connect(transport);
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Servidor MCP corriendo en puerto ${PORT}`);
});
