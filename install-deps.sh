#!/bin/bash

# Colors for output
GREEN='\033[0;32m'
BLUE='\033[0;34m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m' # No Color

print_header() {
    echo -e "${BLUE}================================${NC}"
    echo -e "${BLUE}$1${NC}"
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

print_header "Installing Dependencies for Web Buddy"

# Check if npm is available
if ! command -v npm &> /dev/null; then
    print_error "npm not found. Please install Node.js and npm first."
    print_info "Visit: https://nodejs.org/"
    exit 1
fi

# Install dependencies
print_info "Installing npm dependencies..."
npm install

if [[ $? -eq 0 ]]; then
    print_success "Dependencies installed successfully"
else
    print_error "Failed to install dependencies"
    exit 1
fi

# Build libraries bundle
print_info "Building libraries bundle..."
npm run bundle-libs

if [[ $? -eq 0 ]]; then
    print_success "Libraries bundle built successfully"
    print_info "You can now run ./build.sh to build the extension"
else
    print_error "Failed to build libraries bundle"
    exit 1
fi

print_success "Setup complete! 🚀" 