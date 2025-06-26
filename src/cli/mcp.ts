import { Command } from 'commander';
import chalk from 'chalk';
import { 
  createMCPStimulusManager, 
  createQuickMCPConnection,
  MCPStimulusConfig 
} from '../mcp/integration/stimulus.js';
import { createMCPServer } from '../mcp/server/server.js';
import { StdioTransport } from '../mcp/types/transport.js';

/**
 * CLI Commands for MCP (Model Context Protocol) functionality
 * 
 * Provides commands for:
 * - Connecting to external MCP servers
 * - Testing MCP connections
 * - Managing MCP tools and resources
 * - Creating MCP servers
 */

// =============================================================================
// MCP Client Commands
// =============================================================================

export const mcpCommand = new Command('mcp')
  .description('Model Context Protocol (MCP) client and server commands');

// MCP Connect Command
mcpCommand
  .command('connect')
  .description('Connect to an MCP server and list available tools/resources')
  .requiredOption('-c, --command <command>', 'Server command to execute')
  .option('-a, --args <args...>', 'Arguments to pass to the server command')
  .option('-e, --env <env...>', 'Environment variables (KEY=VALUE format)')
  .option('--timeout <seconds>', 'Connection timeout in seconds', '30')
  .action(async (options) => {
    try {
      console.log(chalk.blue('🔌 Connecting to MCP server...'));
      console.log(chalk.gray(`Command: ${options.command} ${(options.args || []).join(' ')}`));

      // Parse environment variables
      const env: Record<string, string> = {};
      if (options.env) {
        for (const envVar of options.env) {
          const [key, value] = envVar.split('=', 2);
          if (key && value) {
            env[key] = value;
          }
        }
      }

      const manager = await createQuickMCPConnection(
        options.command,
        options.args
      );

      console.log(chalk.green('✅ Connected to MCP server!'));

      // Get server info
      const serverInfo = manager.getServerInfo();
      if (serverInfo.info) {
        console.log(chalk.yellow('\n📋 Server Information:'));
        console.log(`  Name: ${serverInfo.info.name}`);
        console.log(`  Version: ${serverInfo.info.version}`);
      }

      // List available tools
      const tools = manager.getAvailableTools();
      console.log(chalk.yellow(`\n🔧 Available Tools (${tools.length}):`));
      if (tools.length === 0) {
        console.log(chalk.gray('  No tools available'));
      } else {
        for (const tool of tools) {
          console.log(`  ${chalk.cyan(tool.name)}: ${tool.description}`);
          if (tool.metadata?.tags) {
            console.log(chalk.gray(`    Tags: ${tool.metadata.tags.join(', ')}`));
          }
        }
      }

      // List available resources
      const resources = manager.getAvailableResources();
      console.log(chalk.yellow(`\n📚 Available Resources (${resources.length}):`));
      if (resources.length === 0) {
        console.log(chalk.gray('  No resources available'));
      } else {
        for (const resource of resources) {
          console.log(`  ${chalk.cyan(resource.uri)}: ${resource.name}`);
          if (resource.description) {
            console.log(chalk.gray(`    ${resource.description}`));
          }
        }
      }

      await manager.disconnect();
      console.log(chalk.green('\n✨ Disconnected from MCP server'));

    } catch (error) {
      console.error(chalk.red('❌ Failed to connect to MCP server:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// MCP Test Tool Command
mcpCommand
  .command('test-tool')
  .description('Test a specific tool from an MCP server')
  .requiredOption('-c, --command <command>', 'Server command to execute')
  .requiredOption('-t, --tool <toolName>', 'Name of the tool to test')
  .option('-a, --args <args...>', 'Arguments to pass to the server command')
  .option('-p, --params <params>', 'Tool parameters as JSON string', '{}')
  .action(async (options) => {
    try {
      console.log(chalk.blue(`🧪 Testing tool "${options.tool}"...`));

      const manager = await createQuickMCPConnection(
        options.command,
        options.args
      );

      // Parse tool parameters
      let toolParams: Record<string, any> = {};
      try {
        toolParams = JSON.parse(options.params);
      } catch (error) {
        console.error(chalk.red('❌ Invalid JSON in tool parameters'));
        process.exit(1);
      }

      // Check if tool exists
      if (!manager.hasToolAvailable(options.tool)) {
        console.error(chalk.red(`❌ Tool "${options.tool}" not found`));
        
        const availableTools = manager.getAvailableTools();
        if (availableTools.length > 0) {
          console.log(chalk.yellow('\n🔧 Available tools:'));
          for (const tool of availableTools) {
            console.log(`  ${chalk.cyan(tool.name)}`);
          }
        }
        
        await manager.disconnect();
        process.exit(1);
      }

      // Execute the tool
      const tool = manager.getTool(options.tool)!;
      console.log(chalk.gray(`Executing with parameters: ${JSON.stringify(toolParams)}`));

      const startTime = Date.now();
      const result = await tool.execute(toolParams, {
        toolCallId: `test-${Date.now()}`,
        messages: [],
      });
      const executionTime = Date.now() - startTime;

      console.log(chalk.green('\n✅ Tool execution completed!'));
      console.log(chalk.yellow('📋 Result:'));
      console.log(chalk.gray(`Execution time: ${executionTime}ms`));
      console.log(chalk.gray(`Success: ${result.metadata?.success}`));
      
      if (result.metadata?.warnings) {
        console.log(chalk.yellow(`Warnings: ${result.metadata.warnings.join(', ')}`));
      }
      
      console.log('\n📄 Output:');
      console.log(result.result);

      await manager.disconnect();

    } catch (error) {
      console.error(chalk.red('❌ Tool execution failed:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// MCP Read Resource Command
mcpCommand
  .command('read-resource')
  .description('Read a resource from an MCP server')
  .requiredOption('-c, --command <command>', 'Server command to execute')
  .requiredOption('-u, --uri <uri>', 'URI of the resource to read')
  .option('-a, --args <args...>', 'Arguments to pass to the server command')
  .action(async (options) => {
    try {
      console.log(chalk.blue(`📖 Reading resource "${options.uri}"...`));

      const manager = await createQuickMCPConnection(
        options.command,
        options.args
      );

      const content = await manager.readResource(options.uri);

      console.log(chalk.green('✅ Resource read successfully!'));
      console.log(chalk.yellow('\n📄 Content:'));
      console.log(content);

      await manager.disconnect();

    } catch (error) {
      console.error(chalk.red('❌ Failed to read resource:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// =============================================================================
// MCP Server Commands
// =============================================================================

// MCP Create Server Command
mcpCommand
  .command('create-server')
  .description('Create a simple MCP server for testing')
  .option('-n, --name <name>', 'Server name', 'test-mcp-server')
  .option('-v, --version <version>', 'Server version', '1.0.0')
  .option('--with-tools', 'Include example tools')
  .option('--with-resources', 'Include example resources')
  .action(async (options) => {
    try {
      console.log(chalk.blue('🏗️  Creating MCP server...'));

      const server = createMCPServer()
        .withName(options.name)
        .withVersion(options.version);

      if (options.withTools) {
        // Add example tools
        server.addTool('echo', {
          description: 'Echo back the input message',
          inputSchema: {
            type: 'object',
            properties: {
              message: { type: 'string' },
            },
            required: ['message'],
          },
        }, async (params) => ({
          content: [
            {
              type: 'text',
              text: `Echo: ${params.message}`,
            }
          ],
        }));

        server.addTool('add', {
          description: 'Add two numbers',
          inputSchema: {
            type: 'object',
            properties: {
              a: { type: 'number' },
              b: { type: 'number' },
            },
            required: ['a', 'b'],
          },
        }, async (params) => ({
          content: [
            {
              type: 'text',
              text: String((params.a as number) + (params.b as number)),
            }
          ],
        }));
      }

      if (options.withResources) {
        // Add example resources
        server.addResource('info://server', {
          name: 'Server Information',
          description: 'Information about this MCP server',
        }, async () => ({
          uri: 'info://server',
          contents: [
            {
              type: 'text',
              text: `MCP Server: ${options.name} v${options.version}\nCreated at: ${new Date().toISOString()}`,
            }
          ],
        }));
      }

      const builtServer = server.build();

      // Start server with stdio transport
      const transport = new StdioTransport({
        command: 'node', // This would be replaced with actual stdio handling
      });

      console.log(chalk.green('✅ MCP server created!'));
      console.log(chalk.yellow('📋 Server Details:'));
      console.log(`  Name: ${options.name}`);
      console.log(`  Version: ${options.version}`);
      console.log(`  Tools: ${options.withTools ? 'Included' : 'None'}`);
      console.log(`  Resources: ${options.withResources ? 'Included' : 'None'}`);
      
      console.log(chalk.blue('\n💡 To use this server, you would typically:'));
      console.log('  1. Save the server code to a file');
      console.log('  2. Run it with: node server.js');
      console.log('  3. Connect to it using: npm run cli mcp connect -c "node server.js"');

    } catch (error) {
      console.error(chalk.red('❌ Failed to create MCP server:'));
      console.error(chalk.red(error instanceof Error ? error.message : String(error)));
      process.exit(1);
    }
  });

// =============================================================================
// Utility Commands
// =============================================================================

// MCP List Connections Command
mcpCommand
  .command('list')
  .description('List available MCP commands and usage examples')
  .action(() => {
    console.log(chalk.blue('🔧 MCP (Model Context Protocol) Commands\n'));
    
    console.log(chalk.yellow('📡 Client Commands:'));
    console.log('  mcp connect        - Connect to an MCP server and list capabilities');
    console.log('  mcp test-tool      - Test a specific tool from an MCP server');
    console.log('  mcp read-resource  - Read a resource from an MCP server\n');
    
    console.log(chalk.yellow('🏗️  Server Commands:'));
    console.log('  mcp create-server  - Create a simple MCP server for testing\n');
    
    console.log(chalk.yellow('💡 Usage Examples:'));
    console.log(chalk.gray('  # Connect to a local MCP server'));
    console.log('  npm run cli mcp connect -c "node my-server.js"');
    console.log('');
    console.log(chalk.gray('  # Test a tool with parameters'));
    console.log('  npm run cli mcp test-tool -c "node server.js" -t "add" -p \'{"a":5,"b":3}\'');
    console.log('');
    console.log(chalk.gray('  # Read a resource'));
    console.log('  npm run cli mcp read-resource -c "node server.js" -u "file:///path/to/file"');
    console.log('');
    console.log(chalk.gray('  # Create a test server'));
    console.log('  npm run cli mcp create-server --with-tools --with-resources');
  });

export default mcpCommand;