use anyhow::Result;
use log::{debug, error, info, warn};
use rmcp::{
    model::CallToolRequestParam,
    service::{RoleClient, RunningService},
    transport::{ConfigureCommandExt, TokioChildProcess},
    ServiceExt,
};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::sync::Arc;
use tokio::process::Command;
use tokio::sync::Mutex;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPServerConfig {
    pub name: String,
    pub command: Option<String>,
    pub args: Option<Vec<String>>,
    pub env: Option<HashMap<String, String>>,
    #[serde(default = "default_transport")]
    pub transport: String, // "stdio" | "http" | "websocket"
    pub url: Option<String>,
    pub port: Option<u16>,
}

fn default_transport() -> String {
    "stdio".to_string()
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type")]
pub enum JSONSchemaType {
    #[serde(rename = "string")]
    String {
        #[serde(skip_serializing_if = "Option::is_none")]
        min_length: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        max_length: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        pattern: Option<String>,
        #[serde(skip_serializing_if = "Option::is_none")]
        format: Option<String>,
    },
    #[serde(rename = "number")]
    Number {
        #[serde(skip_serializing_if = "Option::is_none")]
        minimum: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        maximum: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        exclusive_minimum: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        exclusive_maximum: Option<f64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        multiple_of: Option<f64>,
    },
    #[serde(rename = "integer")]
    Integer {
        #[serde(skip_serializing_if = "Option::is_none")]
        minimum: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        maximum: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        exclusive_minimum: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        exclusive_maximum: Option<i64>,
        #[serde(skip_serializing_if = "Option::is_none")]
        multiple_of: Option<i64>,
    },
    #[serde(rename = "boolean")]
    Boolean,
    #[serde(rename = "array")]
    Array {
        #[serde(skip_serializing_if = "Option::is_none")]
        items: Option<Box<JSONSchema>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        min_items: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        max_items: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        unique_items: Option<bool>,
    },
    #[serde(rename = "object")]
    Object {
        #[serde(skip_serializing_if = "Option::is_none")]
        properties: Option<std::collections::HashMap<String, JSONSchema>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        required: Option<Vec<String>>,
        #[serde(skip_serializing_if = "Option::is_none")]
        additional_properties: Option<bool>,
        #[serde(skip_serializing_if = "Option::is_none")]
        min_properties: Option<u32>,
        #[serde(skip_serializing_if = "Option::is_none")]
        max_properties: Option<u32>,
    },
    #[serde(rename = "null")]
    Null,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct JSONSchema {
    #[serde(flatten)]
    pub schema_type: JSONSchemaType,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub description: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub default: Option<serde_json::Value>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub examples: Option<Vec<serde_json::Value>>,
    #[serde(rename = "enum", skip_serializing_if = "Option::is_none")]
    pub enum_values: Option<Vec<serde_json::Value>>,
    #[serde(rename = "const", skip_serializing_if = "Option::is_none")]
    pub const_value: Option<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPToolAnnotations {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub audience: Option<Vec<String>>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub priority: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub last_modified: Option<String>,
    #[serde(flatten)]
    pub additional: serde_json::Map<String, serde_json::Value>,
}

// For backward compatibility, create a type alias
pub type MCPToolInputSchema = JSONSchema;

impl Default for MCPToolInputSchema {
    fn default() -> Self {
        Self {
            schema_type: JSONSchemaType::Object {
                properties: Some(std::collections::HashMap::new()),
                required: None,
                additional_properties: None,
                min_properties: None,
                max_properties: None,
            },
            title: None,
            description: None,
            default: None,
            examples: None,
            enum_values: None,
            const_value: None,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct MCPTool {
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    pub description: String,
    #[serde(rename = "inputSchema")]
    pub input_schema: JSONSchema,
    #[serde(rename = "outputSchema", skip_serializing_if = "Option::is_none")]
    pub output_schema: Option<JSONSchema>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub annotations: Option<MCPToolAnnotations>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ToolCallResult {
    pub success: bool,
    pub result: Option<serde_json::Value>,
    pub error: Option<String>,
}

pub struct MCPConnection {
    pub client: RunningService<RoleClient, ()>,
}

pub struct MCPServerManager {
    connections: Arc<Mutex<HashMap<String, MCPConnection>>>,
}

impl MCPServerManager {
    pub fn new() -> Self {
        Self {
            connections: Arc::new(Mutex::new(HashMap::new())),
        }
    }

    /// MCP 서버를 시작하고 연결합니다
    pub async fn start_server(&self, config: MCPServerConfig) -> Result<String> {
        match config.transport.as_str() {
            "stdio" => self.start_stdio_server(config).await,
            "http" => {
                // HTTP 서버는 외부에서 이미 실행 중이라고 가정
                Ok(format!("HTTP server configured: {}", config.name))
            }
            "websocket" => {
                // WebSocket 서버는 외부에서 이미 실행 중이라고 가정
                Ok(format!("WebSocket server configured: {}", config.name))
            }
            _ => Err(anyhow::anyhow!(
                "Unsupported transport: {}",
                config.transport
            )),
        }
    }

    async fn start_stdio_server(&self, config: MCPServerConfig) -> Result<String> {
        let command = config
            .command
            .as_ref()
            .ok_or_else(|| anyhow::anyhow!("Command is required for stdio transport"))?;

        let default_args = vec![];
        let args = config.args.as_ref().unwrap_or(&default_args);

        // Create command with rmcp - configure returns the modified command
        let cmd = Command::new(command).configure(|cmd| {
            for arg in args {
                cmd.arg(arg);
            }

            // Set environment variables if any
            if let Some(env) = &config.env {
                for (key, value) in env {
                    cmd.env(key, value);
                }
            }
        });

        // Create transport and connect using RMCP pattern
        let transport = TokioChildProcess::new(cmd)?;
        debug!("Created transport for command: {} {:?}", command, args);

        let client = ().serve(transport).await?;
        info!("Successfully connected to MCP server: {}", config.name);

        let connection = MCPConnection { client };

        // Store connection
        {
            let mut connections = self.connections.lock().await;
            connections.insert(config.name.clone(), connection);
            debug!("Stored connection for server: {}", config.name);
        }

        Ok(format!(
            "Started and connected to MCP server: {}",
            config.name
        ))
    }

    /// MCP 서버를 중지합니다
    pub async fn stop_server(&self, server_name: &str) -> Result<()> {
        let mut connections = self.connections.lock().await;

        if let Some(connection) = connections.remove(server_name) {
            // Cancel the client connection
            let _ = connection.client.cancel().await;
            info!("Stopped MCP server: {}", server_name);
        }

        Ok(())
    }

    /// 도구를 호출합니다
    pub async fn call_tool(
        &self,
        server_name: &str,
        tool_name: &str,
        arguments: serde_json::Value,
    ) -> ToolCallResult {
        let connections = self.connections.lock().await;

        if let Some(connection) = connections.get(server_name) {
            // RMCP API 사용 - CallToolRequestParam 구조체 사용
            let args_map = if let serde_json::Value::Object(obj) = arguments {
                obj
            } else {
                serde_json::Map::new()
            };

            let call_param = CallToolRequestParam {
                name: tool_name.to_string().into(),
                arguments: Some(args_map),
            };

            match connection.client.call_tool(call_param).await {
                Ok(result) => ToolCallResult {
                    success: true,
                    result: Some(serde_json::to_value(result).unwrap_or(serde_json::Value::Null)),
                    error: None,
                },
                Err(e) => {
                    error!("Error calling tool '{}': {}", tool_name, e);
                    ToolCallResult {
                        success: false,
                        result: None,
                        error: Some(e.to_string()),
                    }
                }
            }
        } else {
            error!("Server '{}' not found", server_name);
            ToolCallResult {
                success: false,
                result: None,
                error: Some(format!("Server '{}' not found", server_name)),
            }
        }
    }

    /// Convert JSON schema to structured JSONSchema
    fn convert_input_schema(schema: serde_json::Value) -> JSONSchema {
        // For now, use serde_json to deserialize directly into our JSONSchema struct
        // This provides better type safety and handles the conversion automatically
        match serde_json::from_value::<JSONSchema>(schema) {
            Ok(json_schema) => json_schema,
            Err(e) => {
                warn!("Failed to parse JSON schema: {}, using default", e);
                JSONSchema::default()
            }
        }
    }

    /// 사용 가능한 도구 목록을 가져옵니다
    pub async fn list_tools(&self, server_name: &str) -> Result<Vec<MCPTool>> {
        let connections = self.connections.lock().await;

        if let Some(connection) = connections.get(server_name) {
            debug!("Found connection for server: {}", server_name);

            match connection.client.list_all_tools().await {
                Ok(tools_response) => {
                    debug!("Raw tools response: {:?}", tools_response);
                    let mut tools = Vec::new();

                    for tool in tools_response {
                        debug!("Processing tool: {:?}", tool);

                        // Convert the input schema to our structured format
                        let input_schema_value = serde_json::to_value(tool.input_schema)
                            .unwrap_or_else(|e| {
                                warn!(
                                    "Failed to serialize input_schema for tool {}: {}",
                                    tool.name, e
                                );
                                serde_json::Value::Object(serde_json::Map::new())
                            });

                        let structured_schema = Self::convert_input_schema(input_schema_value);

                        let mcp_tool = MCPTool {
                            name: tool.name.to_string(),
                            title: None,
                            description: tool.description.unwrap_or_default().to_string(),
                            input_schema: structured_schema,
                            output_schema: None,
                            annotations: None,
                        };

                        debug!(
                            "Converted tool: {} with schema type: {:?}",
                            mcp_tool.name, mcp_tool.input_schema.schema_type
                        );
                        tools.push(mcp_tool);
                    }

                    debug!("Successfully converted {} tools", tools.len());
                    Ok(tools)
                }
                Err(e) => {
                    error!("Error listing tools: {}", e);
                    Err(anyhow::anyhow!("Failed to list tools: {}", e))
                }
            }
        } else {
            warn!("Server '{}' not found in connections", server_name);
            Err(anyhow::anyhow!("Server '{}' not found", server_name))
        }
    }

    /// Get tools from all connected servers
    pub async fn list_all_tools(&self) -> Result<Vec<MCPTool>> {
        let mut all_tools = Vec::new();
        let server_names: Vec<String> = {
            let connections = self.connections.lock().await;
            connections.keys().cloned().collect()
        };

        for server_name in server_names {
            match self.list_tools(&server_name).await {
                Ok(mut tools) => {
                    // Prefix tool names with server name to avoid conflicts
                    for tool in &mut tools {
                        tool.name = format!("{}__{}", server_name, tool.name);
                    }
                    all_tools.extend(tools);
                }
                Err(e) => {
                    warn!("Failed to get tools from server {}: {}", server_name, e);
                    // Continue with other servers instead of failing completely
                }
            }
        }

        Ok(all_tools)
    }

    /// 연결된 서버 목록을 반환합니다
    pub async fn get_connected_servers(&self) -> Vec<String> {
        let connections = self.connections.lock().await;
        connections.keys().cloned().collect()
    }

    /// 특정 서버가 연결되어 있는지 확인합니다
    pub async fn is_server_alive(&self, server_name: &str) -> bool {
        let connections = self.connections.lock().await;
        connections.contains_key(server_name)
    }

    /// 모든 서버의 상태를 확인합니다
    pub async fn check_all_servers(&self) -> HashMap<String, bool> {
        let connections = self.connections.lock().await;
        let mut status_map = HashMap::new();

        for server_name in connections.keys() {
            status_map.insert(server_name.to_string(), true);
        }

        status_map
    }

    /// Validate if a tool schema is compatible with AI service expectations
    pub fn validate_tool_schema(tool: &MCPTool) -> Result<()> {
        // Ensure the schema type is 'object'
        match &tool.input_schema.schema_type {
            JSONSchemaType::Object {
                properties,
                required,
                ..
            } => {
                // Validate required fields exist in properties
                if let (Some(required_fields), Some(props)) = (required, properties) {
                    for req_field in required_fields {
                        if !props.contains_key(req_field) {
                            return Err(anyhow::anyhow!(
                                "Tool '{}' requires field '{}' but it's not defined in properties",
                                tool.name,
                                req_field
                            ));
                        }
                    }
                } else if required.is_some() && properties.is_none() {
                    return Err(anyhow::anyhow!(
                        "Tool '{}' has required fields but no properties defined",
                        tool.name
                    ));
                }
                Ok(())
            }
            _ => Err(anyhow::anyhow!(
                "Tool '{}' has invalid schema type, expected 'object'",
                tool.name
            )),
        }
    }

    /// Get validated tools that are compatible with the AI service
    pub async fn get_validated_tools(&self, server_name: &str) -> Result<Vec<MCPTool>> {
        let tools = self.list_tools(server_name).await?;
        let mut validated_tools = Vec::new();

        for tool in tools {
            match Self::validate_tool_schema(&tool) {
                Ok(()) => {
                    println!("Tool '{}' passed validation", tool.name);
                    validated_tools.push(tool);
                }
                Err(e) => {
                    println!("Tool '{}' failed validation: {}", tool.name, e);
                    // Optionally, you could try to fix the schema or skip the tool
                }
            }
        }

        Ok(validated_tools)
    }
}
