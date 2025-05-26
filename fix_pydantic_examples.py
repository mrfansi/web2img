import re
import sys

def remove_example_attributes(file_path):
    with open(file_path, 'r') as file:
        content = file.read()
    
    # Pattern to match example attributes in Field declarations
    pattern = r'(\s+example=[^,\n]+)(,\s*\n|\n\s*\))'  
    
    # Replace the pattern with just the closing parenthesis or comma
    modified_content = re.sub(pattern, r'\2', content)
    
    with open(file_path, 'w') as file:
        file.write(modified_content)
    
    print(f"Removed example attributes from {file_path}")

if __name__ == "__main__":
    if len(sys.argv) > 1:
        file_path = sys.argv[1]
        remove_example_attributes(file_path)
    else:
        print("Please provide a file path")
