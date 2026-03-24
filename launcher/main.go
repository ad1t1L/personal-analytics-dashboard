// Dashboard launcher: starts the FastAPI backend and opens the login page in your browser.
// Build for your OS from this folder: go build -o ../dashboard-launcher .
// Or run: ./build.sh (writes binaries to ./dist/)
package main

import (
	"fmt"
	"net/http"
	"os"
	"os/exec"
	"os/signal"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"
)

const (
	defaultHost = "127.0.0.1"
	defaultPort = 8000
	loginPath   = "/login"
)

// tauriChild is set when PAD_LAUNCH=tauri starts the desktop app; killed on interrupt.
var tauriChild *exec.Cmd

func main() {
	root := resolveProjectRoot()
	if root == "" {
		fmt.Fprintln(os.Stderr, "Could not find project root (file backend/app.py). Place this program inside the repo, or set PAD_PROJECT_ROOT.")
		os.Exit(1)
	}

	python := findPython(root)
	if python == "" {
		fmt.Fprintln(os.Stderr, "Python not found. Install Python 3.10+, create a venv in the project, or set PAD_PYTHON to the interpreter path.")
		os.Exit(1)
	}

	host := getenv("PAD_HOST", defaultHost)
	port := getenvInt("PAD_PORT", defaultPort)
	baseURL := fmt.Sprintf("http://%s:%d", host, port)

	if !hasDist(root) {
		fmt.Fprintln(os.Stderr, "Note: web/react-version/dist is missing. Run: cd web/react-version && npm install && npm run build")
	}

	uv := exec.Command(python, "-m", "uvicorn", "backend.app:app", "--host", host, "--port", strconv.Itoa(port))
	uv.Dir = root
	uv.Stdout = os.Stdout
	uv.Stderr = os.Stderr
	uv.Env = append(os.Environ(), "PYTHONUNBUFFERED=1")

	if err := uv.Start(); err != nil {
		fmt.Fprintf(os.Stderr, "Failed to start server: %v\n", err)
		os.Exit(1)
	}

	done := make(chan struct{})
	go func() {
		defer close(done)
		_ = uv.Wait()
	}()

	// Stop uvicorn when the launcher receives SIGINT/SIGTERM (Ctrl+C).
	sigCh := make(chan os.Signal, 1)
	// Windows: only Interrupt; Unix: also SIGTERM for graceful stop from process managers.
	if runtime.GOOS == "windows" {
		signal.Notify(sigCh, os.Interrupt)
	} else {
		signal.Notify(sigCh, os.Interrupt, syscall.SIGTERM)
	}
	go func() {
		<-sigCh
		if tauriChild != nil && tauriChild.Process != nil {
			_ = tauriChild.Process.Kill()
		}
		_ = uv.Process.Kill()
	}()

	if waitForServer(baseURL) {
		if err := launchClient(root, baseURL); err != nil {
			fmt.Fprintln(os.Stderr, err)
			_ = uv.Process.Kill()
			os.Exit(1)
		}
	} else {
		fmt.Fprintf(os.Stderr, "Server did not become ready in time. Check errors above. URL: %s\n", baseURL)
		_ = uv.Process.Kill()
		os.Exit(1)
	}

	<-done
}

func resolveProjectRoot() string {
	if e := os.Getenv("PAD_PROJECT_ROOT"); e != "" {
		if isProjectRoot(e) {
			return filepath.Clean(e)
		}
	}
	exe, err := os.Executable()
	if err != nil {
		return ""
	}
	exeDir := filepath.Dir(exe)
	if r := findRepoRoot(exeDir); r != "" {
		return r
	}
	cwd, err := os.Getwd()
	if err != nil {
		return ""
	}
	return findRepoRoot(cwd)
}

func findRepoRoot(start string) string {
	dir := start
	for i := 0; i < 32; i++ {
		if isProjectRoot(dir) {
			return dir
		}
		parent := filepath.Dir(dir)
		if parent == dir {
			break
		}
		dir = parent
	}
	return ""
}

func isProjectRoot(dir string) bool {
	st, err := os.Stat(filepath.Join(dir, "backend", "app.py"))
	return err == nil && !st.IsDir()
}

func hasDist(root string) bool {
	st, err := os.Stat(filepath.Join(root, "web", "react-version", "dist"))
	return err == nil && st.IsDir()
}

func findPython(root string) string {
	if p := os.Getenv("PAD_PYTHON"); p != "" {
		return p
	}
	var candidates []string
	if runtime.GOOS == "windows" {
		candidates = []string{
			filepath.Join(root, "venv", "Scripts", "python.exe"),
			filepath.Join(root, ".venv", "Scripts", "python.exe"),
		}
	} else {
		candidates = []string{
			filepath.Join(root, "venv", "bin", "python3"),
			filepath.Join(root, "venv", "bin", "python"),
			filepath.Join(root, ".venv", "bin", "python3"),
			filepath.Join(root, ".venv", "bin", "python"),
		}
	}
	for _, c := range candidates {
		if st, err := os.Stat(c); err == nil && !st.IsDir() {
			return c
		}
	}
	if p, err := exec.LookPath("python3"); err == nil {
		return p
	}
	if p, err := exec.LookPath("python"); err == nil {
		return p
	}
	return ""
}

func getenv(key, def string) string {
	if v := os.Getenv(key); v != "" {
		return v
	}
	return def
}

func getenvInt(key string, def int) int {
	v := os.Getenv(key)
	if v == "" {
		return def
	}
	n, err := strconv.Atoi(v)
	if err != nil {
		return def
	}
	return n
}

func waitForServer(base string) bool {
	client := &http.Client{Timeout: 2 * time.Second}
	for i := 0; i < 60; i++ {
		resp, err := client.Get(base + "/openapi.json")
		if err == nil {
			resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return true
			}
		}
		time.Sleep(500 * time.Millisecond)
	}
	return false
}

func openBrowser(url string) error {
	switch runtime.GOOS {
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", url).Start()
	case "darwin":
		return exec.Command("open", url).Start()
	default:
		return exec.Command("xdg-open", url).Start()
	}
}

func launchClient(root, baseURL string) error {
	mode := strings.ToLower(strings.TrimSpace(getenv("PAD_LAUNCH", "tauri")))
	switch mode {
	case "browser":
		return openBrowser(baseURL + loginPath)
	case "none":
		fmt.Fprintf(os.Stderr, "Server is up at %s — PAD_LAUNCH=none (open the app manually).\n", baseURL)
		return nil
	case "tauri":
		return launchTauri(root)
	default:
		return fmt.Errorf("unknown PAD_LAUNCH=%q (use tauri, browser, or none)", mode)
	}
}

func tauriExeBase() string {
	if runtime.GOOS == "windows" {
		return "desktoptauri-widget.exe"
	}
	return "desktoptauri-widget"
}

func launchTauri(root string) error {
	if p := os.Getenv("PAD_TAURI_BINARY"); p != "" {
		cmd := exec.Command(p)
		cmd.Dir = root
		cmd.Stdout = os.Stdout
		cmd.Stderr = os.Stderr
		if err := cmd.Start(); err != nil {
			return err
		}
		tauriChild = cmd
		return nil
	}
	base := filepath.Join(root, "web", "react-version", "src-tauri", "target")
	for _, sub := range []string{"release", "debug"} {
		bin := filepath.Join(base, sub, tauriExeBase())
		if st, err := os.Stat(bin); err == nil && !st.IsDir() {
			cmd := exec.Command(bin)
			cmd.Dir = root
			cmd.Stdout = os.Stdout
			cmd.Stderr = os.Stderr
			if err := cmd.Start(); err != nil {
				return err
			}
			tauriChild = cmd
			return nil
		}
	}
	react := filepath.Join(root, "web", "react-version")
	npm := "npm"
	if runtime.GOOS == "windows" {
		if _, err := exec.LookPath("npm.cmd"); err == nil {
			npm = "npm.cmd"
		}
	}
	cmd := exec.Command(npm, "run", "tauri:dev")
	cmd.Dir = react
	cmd.Env = os.Environ()
	cmd.Stdout = os.Stdout
	cmd.Stderr = os.Stderr
	if err := cmd.Start(); err != nil {
		return fmt.Errorf("Tauri binary not found under src-tauri/target; npm run tauri:dev failed: %w\n"+
			"Build once: cd web/react-version && npm install && npm run tauri:build", err)
	}
	tauriChild = cmd
	return nil
}
