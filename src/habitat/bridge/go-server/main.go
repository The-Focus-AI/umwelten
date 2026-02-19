package main

import (
	"context"
	"flag"
	"fmt"
	"log"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"time"

	"github.com/modelcontextprotocol/go-sdk/mcp"
)

var (
	port = flag.Int("port", 8080, "port to listen on")
)

func main() {
	flag.Parse()

	// Create MCP server
	server := mcp.NewServer(&mcp.Implementation{
		Name:    "habitat-bridge",
		Version: "1.0.0",
	}, nil)

	// Register all tools
	registerTools(server)

	// Create streamable HTTP handler
	handler := mcp.NewStreamableHTTPHandler(func(req *http.Request) *mcp.Server {
		return server
	}, nil)

	addr := fmt.Sprintf(":%d", *port)
	log.Printf("Habitat Bridge MCP Server listening on port %d", *port)

	if err := http.ListenAndServe(addr, handler); err != nil {
		log.Fatalf("Server failed: %v", err)
	}
}

func registerTools(server *mcp.Server) {
	// Git tools
	mcp.AddTool(server, &mcp.Tool{
		Name:        "git_clone",
		Description: "Clone a git repository",
	}, handleGitClone)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "git_status",
		Description: "Get git status",
	}, handleGitStatus)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "git_commit",
		Description: "Commit changes",
	}, handleGitCommit)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "git_push",
		Description: "Push changes",
	}, handleGitPush)

	// File system tools
	mcp.AddTool(server, &mcp.Tool{
		Name:        "fs_read",
		Description: "Read a file",
	}, handleFsRead)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "fs_write",
		Description: "Write a file",
	}, handleFsWrite)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "fs_list",
		Description: "List directory contents",
	}, handleFsList)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "fs_exists",
		Description: "Check if a path exists",
	}, handleFsExists)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "fs_stat",
		Description: "Get file/directory stats",
	}, handleFsStat)

	// Execution tools
	mcp.AddTool(server, &mcp.Tool{
		Name:        "exec_run",
		Description: "Execute a command",
	}, handleExecRun)

	// Bridge tools
	mcp.AddTool(server, &mcp.Tool{
		Name:        "bridge_health",
		Description: "Check bridge health",
	}, handleBridgeHealth)

	mcp.AddTool(server, &mcp.Tool{
		Name:        "bridge_logs",
		Description: "Get bridge logs",
	}, handleBridgeLogs)
}

// Tool parameter types
type GitCloneParams struct {
	RepoURL string `json:"repoUrl" jsonschema:"Git repository URL to clone"`
	Path    string `json:"path,omitempty" jsonschema:"Target directory (defaults to /workspace)"`
}

type GitStatusParams struct {
	Path string `json:"path,omitempty" jsonschema:"Repository path (defaults to /workspace)"`
}

type GitCommitParams struct {
	Message string `json:"message" jsonschema:"Commit message"`
	Path    string `json:"path,omitempty" jsonschema:"Repository path (defaults to /workspace)"`
}

type GitPushParams struct {
	Path string `json:"path,omitempty" jsonschema:"Repository path (defaults to /workspace)"`
}

type FsReadParams struct {
	Path string `json:"path" jsonschema:"File path to read"`
}

type FsWriteParams struct {
	Path    string `json:"path" jsonschema:"File path to write"`
	Content string `json:"content" jsonschema:"Content to write"`
}

type FsListParams struct {
	Path string `json:"path,omitempty" jsonschema:"Directory path (defaults to /workspace)"`
}

type FsExistsParams struct {
	Path string `json:"path" jsonschema:"Path to check"`
}

type FsStatParams struct {
	Path string `json:"path" jsonschema:"Path to stat"`
}

type ExecRunParams struct {
	Command string `json:"command" jsonschema:"Command to execute"`
	Timeout int    `json:"timeout,omitempty" jsonschema:"Timeout in milliseconds (default: 60000)"`
	Cwd     string `json:"cwd,omitempty" jsonschema:"Working directory (default: /workspace)"`
}

type BridgeLogsParams struct {
	Lines int `json:"lines,omitempty" jsonschema:"Number of log lines to return (default: 100)"`
}

// Log buffer for bridge_logs
var logBuffer []LogEntry

type LogEntry struct {
	Timestamp string `json:"timestamp"`
	Level     string `json:"level"`
	Message   string `json:"message"`
}

func logMsg(level, message string) {
	entry := LogEntry{
		Timestamp: time.Now().Format(time.RFC3339),
		Level:     level,
		Message:   message,
	}
	logBuffer = append(logBuffer, entry)
	if len(logBuffer) > 1000 {
		logBuffer = logBuffer[1:]
	}
	fmt.Fprintf(os.Stderr, "[%s] %s: %s\n", entry.Timestamp, level, message)
}

func resolvePath(inputPath string) string {
	if inputPath == "" {
		return "/workspace"
	}
	if !strings.HasPrefix(inputPath, "/") {
		return filepath.Join("/workspace", inputPath)
	}
	return inputPath
}

func isAllowedPath(path string) bool {
	return strings.HasPrefix(path, "/workspace") || strings.HasPrefix(path, "/opt")
}

// Tool handlers
func handleGitClone(ctx context.Context, req *mcp.CallToolRequest, params *GitCloneParams) (*mcp.CallToolResult, any, error) {
	targetPath := params.Path
	if targetPath == "" {
		targetPath = "/workspace"
	}

	logMsg("info", fmt.Sprintf("Cloning %s to %s", params.RepoURL, targetPath))

	cmd := exec.CommandContext(ctx, "git", "clone", "--depth", "1", params.RepoURL, targetPath)
	cmd.Env = os.Environ()
	if os.Getenv("GITHUB_TOKEN") != "" {
		cmd.Env = append(cmd.Env, "GIT_ASKPASS=echo", "GIT_USERNAME=token", "GIT_PASSWORD="+os.Getenv("GITHUB_TOKEN"))
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, nil, fmt.Errorf("git clone failed: %w\nOutput: %s", err, string(output))
	}

	return &mcp.CallToolResult{
		Content: []mcp.Content{
			&mcp.TextContent{Text: fmt.Sprintf("Successfully cloned %s to %s", params.RepoURL, targetPath)},
		},
	}, nil, nil
}

func handleGitStatus(ctx context.Context, req *mcp.CallToolRequest, params *GitStatusParams) (*mcp.CallToolResult, any, error) {
	repoPath := resolvePath(params.Path)

	cmd := exec.CommandContext(ctx, "git", "-C", repoPath, "status", "--porcelain")
	output, err := cmd.Output()
	if err != nil {
		return nil, nil, fmt.Errorf("git status failed: %w", err)
	}

	return &mcp.CallToolResult{
		Content: []mcp.Content{
			&mcp.TextContent{Text: fmt.Sprintf("Git status for %s:\n%s", repoPath, string(output))},
		},
	}, nil, nil
}

func handleGitCommit(ctx context.Context, req *mcp.CallToolRequest, params *GitCommitParams) (*mcp.CallToolResult, any, error) {
	repoPath := resolvePath(params.Path)

	addCmd := exec.CommandContext(ctx, "git", "-C", repoPath, "add", "-A")
	if err := addCmd.Run(); err != nil {
		return nil, nil, fmt.Errorf("git add failed: %w", err)
	}

	commitCmd := exec.CommandContext(ctx, "git", "-C", repoPath, "commit", "-m", params.Message)
	output, err := commitCmd.CombinedOutput()
	if err != nil {
		return nil, nil, fmt.Errorf("git commit failed: %w\nOutput: %s", err, string(output))
	}

	return &mcp.CallToolResult{
		Content: []mcp.Content{
			&mcp.TextContent{Text: fmt.Sprintf("Committed changes: %s\n%s", params.Message, string(output))},
		},
	}, nil, nil
}

func handleGitPush(ctx context.Context, req *mcp.CallToolRequest, params *GitPushParams) (*mcp.CallToolResult, any, error) {
	repoPath := resolvePath(params.Path)

	cmd := exec.CommandContext(ctx, "git", "-C", repoPath, "push")
	cmd.Env = os.Environ()
	if os.Getenv("GITHUB_TOKEN") != "" {
		cmd.Env = append(cmd.Env, "GIT_ASKPASS=echo", "GIT_USERNAME=token", "GIT_PASSWORD="+os.Getenv("GITHUB_TOKEN"))
	}

	output, err := cmd.CombinedOutput()
	if err != nil {
		return nil, nil, fmt.Errorf("git push failed: %w\nOutput: %s", err, string(output))
	}

	return &mcp.CallToolResult{
		Content: []mcp.Content{
			&mcp.TextContent{Text: fmt.Sprintf("Pushed changes to remote:\n%s", string(output))},
		},
	}, nil, nil
}

func handleFsRead(ctx context.Context, req *mcp.CallToolRequest, params *FsReadParams) (*mcp.CallToolResult, any, error) {
	resolved := resolvePath(params.Path)
	if !isAllowedPath(resolved) {
		return nil, nil, fmt.Errorf("access denied: path outside allowed directories")
	}

	content, err := os.ReadFile(resolved)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to read file: %w", err)
	}

	return &mcp.CallToolResult{
		Content: []mcp.Content{
			&mcp.TextContent{Text: string(content)},
		},
		Meta: map[string]any{
			"path": resolved,
			"size": len(content),
		},
	}, nil, nil
}

func handleFsWrite(ctx context.Context, req *mcp.CallToolRequest, params *FsWriteParams) (*mcp.CallToolResult, any, error) {
	resolved := resolvePath(params.Path)
	if !isAllowedPath(resolved) {
		return nil, nil, fmt.Errorf("access denied: path outside allowed directories")
	}

	dir := filepath.Dir(resolved)
	if err := os.MkdirAll(dir, 0755); err != nil {
		return nil, nil, fmt.Errorf("failed to create directory: %w", err)
	}

	if err := os.WriteFile(resolved, []byte(params.Content), 0644); err != nil {
		return nil, nil, fmt.Errorf("failed to write file: %w", err)
	}

	return &mcp.CallToolResult{
		Content: []mcp.Content{
			&mcp.TextContent{Text: fmt.Sprintf("Successfully wrote %d bytes to %s", len(params.Content), resolved)},
		},
	}, nil, nil
}

func handleFsList(ctx context.Context, req *mcp.CallToolRequest, params *FsListParams) (*mcp.CallToolResult, any, error) {
	resolved := resolvePath(params.Path)
	if !isAllowedPath(resolved) {
		return nil, nil, fmt.Errorf("access denied: path outside allowed directories")
	}

	entries, err := os.ReadDir(resolved)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to list directory: %w", err)
	}

	var result strings.Builder
	for _, entry := range entries {
		prefix := "[F]"
		if entry.IsDir() {
			prefix = "[D]"
		}
		result.WriteString(fmt.Sprintf("%s %s\n", prefix, entry.Name()))
	}

	return &mcp.CallToolResult{
		Content: []mcp.Content{
			&mcp.TextContent{Text: result.String()},
		},
	}, nil, nil
}

func handleFsExists(ctx context.Context, req *mcp.CallToolRequest, params *FsExistsParams) (*mcp.CallToolResult, any, error) {
	resolved := resolvePath(params.Path)
	if !isAllowedPath(resolved) {
		return nil, nil, fmt.Errorf("access denied: path outside allowed directories")
	}

	_, err := os.Stat(resolved)
	exists := err == nil

	return &mcp.CallToolResult{
		Content: []mcp.Content{
			&mcp.TextContent{Text: fmt.Sprintf("Path exists: %v (%s)", exists, resolved)},
		},
		Meta: map[string]any{
			"exists": exists,
			"path":   resolved,
		},
	}, nil, nil
}

func handleFsStat(ctx context.Context, req *mcp.CallToolRequest, params *FsStatParams) (*mcp.CallToolResult, any, error) {
	resolved := resolvePath(params.Path)
	if !isAllowedPath(resolved) {
		return nil, nil, fmt.Errorf("access denied: path outside allowed directories")
	}

	info, err := os.Stat(resolved)
	if err != nil {
		return nil, nil, fmt.Errorf("failed to stat path: %w", err)
	}

	fileType := "file"
	if info.IsDir() {
		fileType = "directory"
	}

	return &mcp.CallToolResult{
		Content: []mcp.Content{
			&mcp.TextContent{Text: fmt.Sprintf("%s: %d bytes, %s", resolved, info.Size(), fileType)},
		},
		Meta: map[string]any{
			"path":         resolved,
			"size":         info.Size(),
			"isDirectory":  info.IsDir(),
			"isFile":       !info.IsDir(),
			"modified":     info.ModTime().Format(time.RFC3339),
		},
	}, nil, nil
}

func handleExecRun(ctx context.Context, req *mcp.CallToolRequest, params *ExecRunParams) (*mcp.CallToolResult, any, error) {
	workingDir := resolvePath(params.Cwd)
	if !isAllowedPath(workingDir) {
		return nil, nil, fmt.Errorf("access denied: cwd outside allowed directories")
	}

	timeout := params.Timeout
	if timeout == 0 {
		timeout = 60000
	}

	ctx, cancel := context.WithTimeout(ctx, time.Duration(timeout)*time.Millisecond)
	defer cancel()

	logMsg("info", fmt.Sprintf("Executing: %s in %s", params.Command, workingDir))

	cmd := exec.CommandContext(ctx, "sh", "-c", params.Command)
	cmd.Dir = workingDir
	cmd.Env = os.Environ()

	output, err := cmd.CombinedOutput()
	if err != nil {
		return &mcp.CallToolResult{
			Content: []mcp.Content{
				&mcp.TextContent{Text: string(output)},
			},
			IsError: true,
		}, nil, nil
	}

	return &mcp.CallToolResult{
		Content: []mcp.Content{
			&mcp.TextContent{Text: string(output)},
		},
	}, nil, nil
}

func handleBridgeHealth(ctx context.Context, req *mcp.CallToolRequest, params *struct{}) (*mcp.CallToolResult, any, error) {
	return &mcp.CallToolResult{
		Content: []mcp.Content{
			&mcp.TextContent{Text: "Bridge is healthy"},
		},
		Meta: map[string]any{
			"status":    "healthy",
			"timestamp": time.Now().Format(time.RFC3339),
			"workspace": "/workspace",
		},
	}, nil, nil
}

func handleBridgeLogs(ctx context.Context, req *mcp.CallToolRequest, params *BridgeLogsParams) (*mcp.CallToolResult, any, error) {
	lines := params.Lines
	if lines == 0 {
		lines = 100
	}

	start := len(logBuffer) - lines
	if start < 0 {
		start = 0
	}

	var result strings.Builder
	for _, entry := range logBuffer[start:] {
		result.WriteString(fmt.Sprintf("[%s] %s: %s\n", entry.Timestamp, entry.Level, entry.Message))
	}

	return &mcp.CallToolResult{
		Content: []mcp.Content{
			&mcp.TextContent{Text: result.String()},
		},
	}, nil, nil
}
