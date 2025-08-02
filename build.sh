#!/bin/bash

# Web Buddy Chrome Extension - Build & Debug Script
# This script prepares the extension for development and helps load it in Chrome

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Extension info
EXTENSION_NAME="Web Buddy"
VERSION="1.0"
BUILD_DIR="build"
ICONS_DIR="icons"

# Helper functions
print_header() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE}  $1${NC}"
    echo -e "${BLUE}================================${NC}"
}

print_success() {
    echo -e "${GREEN}✓ $1${NC}"
}

print_warning() {
    echo -e "${YELLOW}⚠ $1${NC}"
}

print_error() {
    echo -e "${RED}✗ $1${NC}"
}

print_info() {
    echo -e "${BLUE}ℹ $1${NC}"
}

# Check if required files exist
check_required_files() {
    print_header "Checking Required Files"
    
    local required_files=(
        "manifest.json"
        "service-worker.js"
        "content-script.js"
        "offscreen.html"
        "offscreen.js"
        "options.html"
        "options.js"
        "onboarding.html"
        "onboarding.js"
        "popup.html"
        "popup.js"
        "src/characters.js"
    )
    
    local missing_files=()
    
    for file in "${required_files[@]}"; do
        if [[ -f "$file" ]]; then
            print_success "Found $file"
        else
            print_error "Missing $file"
            missing_files+=("$file")
        fi
    done
    
    if [[ ${#missing_files[@]} -gt 0 ]]; then
        print_error "Missing required files. Please ensure all files are present."
        exit 1
    fi
}

# Validate manifest.json
validate_manifest() {
    print_header "Validating Manifest"
    
    if ! command -v jq &> /dev/null; then
        print_warning "jq not found. Skipping manifest validation."
        print_info "Install jq for better validation: brew install jq (macOS) or apt-get install jq (Linux)"
        return
    fi
    
    if jq empty manifest.json 2>/dev/null; then
        print_success "manifest.json is valid JSON"
        
        # Check manifest version
        local manifest_version=$(jq -r '.manifest_version' manifest.json)
        if [[ "$manifest_version" == "3" ]]; then
            print_success "Using Manifest V3"
        else
            print_warning "Not using Manifest V3. Consider upgrading."
        fi
        
        # Check required permissions
        local permissions=$(jq -r '.permissions[]?' manifest.json)
        print_info "Permissions: $permissions"
        
    else
        print_error "manifest.json contains invalid JSON"
        exit 1
    fi
}

# Create placeholder icons if missing
create_placeholder_icons() {
    print_header "Checking Icons"
    
    local icon_sizes=(16 48 128)
    local icons_needed=false
    
    # Check if icons directory exists
    if [[ ! -d "$ICONS_DIR" ]]; then
        print_info "Creating icons directory..."
        mkdir -p "$ICONS_DIR"
        icons_needed=true
    fi
    
    # Check for required icon sizes
    for size in "${icon_sizes[@]}"; do
        local icon_file="$ICONS_DIR/icon${size}.png"
        if [[ ! -f "$icon_file" ]]; then
            icons_needed=true
            break
        fi
    done
    
    if [[ "$icons_needed" == true ]]; then
        print_warning "Missing icon files. Creating placeholder icons..."
        
        # Check if ImageMagick is available
        if command -v convert &> /dev/null; then
            print_info "Using ImageMagick to create placeholder icons..."
            for size in "${icon_sizes[@]}"; do
                local icon_file="$ICONS_DIR/icon${size}.png"
                if [[ ! -f "$icon_file" ]]; then
                    convert -size ${size}x${size} xc:'#007bff' \
                        -gravity center -pointsize $((size/4)) -fill white \
                        -annotate +0+0 "VTT" "$icon_file"
                    print_success "Created $icon_file"
                fi
            done
        else
            print_warning "ImageMagick not found. Creating placeholder files..."
            print_info "Install ImageMagick for proper icons: brew install imagemagick (macOS)"
            
            # Create empty PNG files as placeholders
            for size in "${icon_sizes[@]}"; do
                local icon_file="$ICONS_DIR/icon${size}.png"
                if [[ ! -f "$icon_file" ]]; then
                    # Create a minimal PNG file (1x1 transparent pixel)
                    echo -n -e '\x89\x50\x4e\x47\x0d\x0a\x1a\x0a\x00\x00\x00\x0d\x49\x48\x44\x52\x00\x00\x00\x01\x00\x00\x00\x01\x08\x06\x00\x00\x00\x1f\x15\xc4\x89\x00\x00\x00\x0b\x49\x44\x41\x54\x78\x9c\x63\x60\x00\x02\x00\x00\x05\x00\x01\x0d\x0a\x2d\xb4\x00\x00\x00\x00\x49\x45\x4e\x44\xae\x42\x60\x82' > "$icon_file"
                    print_info "Created placeholder $icon_file"
                fi
            done
        fi
    else
        print_success "All required icons found"
    fi
}

# Build libraries bundle
build_libraries() {
    echo "ℹ Building libraries bundle..."
    
    # Skip webpack and use our simple direct approach
    # npm run bundle-libs
    
    
    echo "✓ Libraries bundle built successfully"
}

# Create build directory and copy files
create_build() {
    print_header "Creating Build"
    
    # Clean and create build directory
    if [[ -d "$BUILD_DIR" ]]; then
        print_info "Cleaning existing build directory..."
        rm -rf "$BUILD_DIR"
    fi
    
    mkdir -p "$BUILD_DIR"
    print_success "Created build directory"
    
    # Create src directory for module files
    mkdir -p "$BUILD_DIR/src"
    print_success "Created build/src directory"
    
    # Copy all extension files
    local files_to_copy=(
        "manifest.json"
        "service-worker.js"
        "content-script.js"
        "offscreen.html"
        "offscreen.js"
        "options.html"
        "options.js"
        "onboarding.html"
        "onboarding.js"
        "popup.html"
        "popup.js"
    )
    
    for file in "${files_to_copy[@]}"; do
        cp "$file" "$BUILD_DIR/"
        print_success "Copied $file"
    done
    
    # Copy character definitions
    if [[ -f "src/characters.js" ]]; then
        cp "src/characters.js" "$BUILD_DIR/src/"
        print_success "Copied src/characters.js"
    fi
    
    # Copy icons directory
    if [[ -d "$ICONS_DIR" ]]; then
        cp -r "$ICONS_DIR" "$BUILD_DIR/"
        print_success "Copied icons directory"
    fi
    
    # Copy dist directory if it exists
    if [[ -d "dist" ]]; then
        cp -r "dist" "$BUILD_DIR/"
        print_success "Copied dist directory"
    fi
    
    print_success "Build created in $BUILD_DIR/"
}

# Open Chrome with extensions page
open_chrome_extensions() {
    print_header "Opening Chrome Extensions"
    
    local chrome_paths=(
        "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome"  # macOS
        "/usr/bin/google-chrome"                                        # Linux
        "/usr/bin/google-chrome-stable"                                 # Linux alternative
        "/usr/bin/chromium-browser"                                     # Chromium
        "google-chrome"                                                  # PATH
        "chrome"                                                         # PATH
    )
    
    local chrome_found=false
    
    for chrome_path in "${chrome_paths[@]}"; do
        if command -v "$chrome_path" &> /dev/null || [[ -x "$chrome_path" ]]; then
            print_info "Opening Chrome extensions page..."
            if [[ "$chrome_path" == *"Applications"* ]]; then
                # macOS
                open -a "Google Chrome" "chrome://extensions/"
            else
                # Linux/Windows
                "$chrome_path" "chrome://extensions/" &
            fi
            chrome_found=true
            break
        fi
    done
    
    if [[ "$chrome_found" == false ]]; then
        print_warning "Chrome not found in common locations"
        print_info "Please manually open: chrome://extensions/"
    fi
}

# Print instructions for loading extension
print_instructions() {
    print_header "Debug Mode Instructions"
    
    echo -e "${GREEN}Extension is ready for debugging!${NC}"
    echo ""
    echo -e "${YELLOW}To load the extension in Chrome:${NC}"
    echo -e "1. Open Chrome and go to: ${BLUE}chrome://extensions/${NC}"
    echo -e "2. Enable ${BLUE}'Developer mode'${NC} (toggle in top-right)"
    echo -e "3. Click ${BLUE}'Load unpacked'${NC}"
    echo -e "4. Select the ${BLUE}'$BUILD_DIR'${NC} directory"
    echo -e "5. The extension should now appear in your extensions list"
    echo ""
    echo -e "${YELLOW}To configure the extension:${NC}"
    echo -e "1. Click the extension icon in Chrome toolbar"
    echo -e "2. Click ${BLUE}'Options'${NC} in the popup"
    echo -e "3. Enter your ${BLUE}ElevenLabs API key${NC}"
    echo -e "4. Click ${BLUE}'Save'${NC}"
    echo ""
    echo -e "${YELLOW}Debug Tools:${NC}"
    echo -e "• Service Worker: Chrome DevTools → Extensions → Service Worker"
    echo -e "• Popup: Right-click extension icon → 'Inspect popup'"
    echo -e "• Content Script: F12 on any webpage → Console"
    echo -e "• Options Page: Right-click on options page → 'Inspect'"
    echo ""
    echo -e "${GREEN}Happy debugging! 🚀${NC}"
}

# Watch for file changes (if fswatch is available)
watch_files() {
    if command -v fswatch &> /dev/null; then
        print_header "File Watcher"
        print_info "Starting file watcher... (Press Ctrl+C to stop)"
        print_info "Files will be automatically copied to build/ when changed"
        
        fswatch -o . --exclude='build/.*' --exclude='\.git/.*' | while read f; do
            print_info "Files changed, updating build..."
            create_build
            print_success "Build updated!"
        done
    else
        print_info "Install fswatch for automatic file watching: brew install fswatch (macOS)"
    fi
}

# Main execution
main() {
    print_header "Web Buddy Tech Demo - Build Script"
    
    # Parse command line arguments
    local watch_mode=false
    local skip_chrome=false
    
    while [[ $# -gt 0 ]]; do
        case $1 in
            --watch|-w)
                watch_mode=true
                shift
                ;;
            --no-chrome|-n)
                skip_chrome=true
                shift
                ;;
            --help|-h)
                echo "Usage: $0 [OPTIONS]"
                echo "Options:"
                echo "  --watch, -w      Watch for file changes and auto-rebuild"
                echo "  --no-chrome, -n  Skip opening Chrome extensions page"
                echo "  --help, -h       Show this help message"
                exit 0
                ;;
            *)
                print_error "Unknown option: $1"
                exit 1
                ;;
        esac
    done
    
    # Run build steps
    check_required_files
    validate_manifest
    create_placeholder_icons
    build_libraries
    create_build
    
    if [[ "$skip_chrome" == false ]]; then
        open_chrome_extensions
    fi
    
    print_instructions
    
    if [[ "$watch_mode" == true ]]; then
        watch_files
    fi
}

# Run main function with all arguments
main "$@" 