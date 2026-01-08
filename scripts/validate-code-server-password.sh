#!/bin/bash

# Script to validate CODE_SERVER_PASSWORD strength
# Run this before starting code-server to ensure password meets security requirements

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

echo "🔒 Validating CODE_SERVER_PASSWORD..."

# Check if .env file exists
if [ ! -f .env ]; then
    echo -e "${RED}❌ Error: .env file not found${NC}"
    echo "   Create .env file from .env.example:"
    echo "   cp .env.example .env"
    exit 1
fi

# Load password from .env
PASSWORD=$(grep "^CODE_SERVER_PASSWORD=" .env | cut -d'=' -f2- | tr -d ' ')

# Check if password is set
if [ -z "$PASSWORD" ]; then
    echo -e "${RED}❌ Error: CODE_SERVER_PASSWORD is not set${NC}"
    echo "   Set a strong password in .env file"
    echo ""
    echo "   Example:"
    echo "   CODE_SERVER_PASSWORD=\$(openssl rand -base64 24)"
    exit 1
fi

# Validation checks
ERRORS=0

# Check length (minimum 12 characters)
if [ ${#PASSWORD} -lt 12 ]; then
    echo -e "${RED}❌ Password is too short (${#PASSWORD} chars, minimum 12)${NC}"
    ((ERRORS++))
else
    echo -e "${GREEN}✓${NC} Length: ${#PASSWORD} characters"
fi

# Check for uppercase letters
if [[ ! "$PASSWORD" =~ [A-Z] ]]; then
    echo -e "${RED}❌ Password must contain uppercase letters${NC}"
    ((ERRORS++))
else
    echo -e "${GREEN}✓${NC} Contains uppercase letters"
fi

# Check for lowercase letters
if [[ ! "$PASSWORD" =~ [a-z] ]]; then
    echo -e "${RED}❌ Password must contain lowercase letters${NC}"
    ((ERRORS++))
else
    echo -e "${GREEN}✓${NC} Contains lowercase letters"
fi

# Check for numbers
if [[ ! "$PASSWORD" =~ [0-9] ]]; then
    echo -e "${RED}❌ Password must contain numbers${NC}"
    ((ERRORS++))
else
    echo -e "${GREEN}✓${NC} Contains numbers"
fi

# Check for special characters
if [[ ! "$PASSWORD" =~ [^a-zA-Z0-9] ]]; then
    echo -e "${RED}❌ Password must contain special characters${NC}"
    ((ERRORS++))
else
    echo -e "${GREEN}✓${NC} Contains special characters"
fi

# Check for common weak passwords
WEAK_PASSWORDS=("password" "password123" "devOrbit" "devOrbit123" "admin" "admin123" "12345678" "qwerty")
for weak in "${WEAK_PASSWORDS[@]}"; do
    if [[ "$PASSWORD" == *"$weak"* ]]; then
        echo -e "${YELLOW}⚠️  Warning: Password contains common weak pattern: '$weak'${NC}"
        ((ERRORS++))
        break
    fi
done

echo ""

# Final result
if [ $ERRORS -eq 0 ]; then
    echo -e "${GREEN}✅ Password validation passed!${NC}"
    echo ""
    echo "You can now start code-server:"
    echo "  docker compose up code-server -d"
    exit 0
else
    echo -e "${RED}❌ Password validation failed with $ERRORS error(s)${NC}"
    echo ""
    echo "Generate a strong password:"
    echo "  openssl rand -base64 24"
    echo "  pwgen -s 20 1"
    echo ""
    echo "Requirements:"
    echo "  • Minimum 12 characters (16+ recommended)"
    echo "  • Uppercase and lowercase letters"
    echo "  • Numbers"
    echo "  • Special characters (!@#$%^&*)"
    echo "  • No common words or patterns"
    exit 1
fi
