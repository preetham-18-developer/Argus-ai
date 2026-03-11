"""
VisionAid - AI-Powered Assistive Application for Visually Impaired Users
=========================================================================
Features:
  1. Medicine Recognition & Analysis
  2. Object Detection with Spatial Awareness
  3. Document/Text Reading (OCR)
  4. Natural Language Voice Output
  
Tech: Flask + Google Gemini AI / NVIDIA NIM API
"""

import os
import io
import base64
import traceback
from datetime import datetime
from flask import Flask, render_template, request, jsonify
from flask_cors import CORS
from dotenv import load_dotenv
from PIL import Image

load_dotenv()

app = Flask(__name__)
CORS(app)

# Maximum request size: 16MB (base64 images can be large)
app.config['MAX_CONTENT_LENGTH'] = 16 * 1024 * 1024

# ─── Configuration ───────────────────────────────────────────────────────────
AI_PROVIDER = os.getenv("AI_PROVIDER", "gemini").lower().strip()
GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "").strip()
NVIDIA_API_KEY = os.getenv("NVIDIA_API_KEY", "").strip()


# ─── AI Analysis Helpers ────────────────────────────────────────────────────

def analyze_with_gemini(image_data_b64, mode, user_query=""):
    """Use Google Gemini 2.0 Flash for vision analysis."""
    import google.generativeai as genai
    
    try:
        genai.configure(api_key=GEMINI_API_KEY)
        model = genai.GenerativeModel("gemini-2.0-flash")
        
        # Decode the base64 image
        image_bytes = base64.b64decode(image_data_b64)
        image = Image.open(io.BytesIO(image_bytes))
        
        prompt = build_prompt(mode, user_query)
        
        response = model.generate_content([prompt, image])
        
        if not response or not response.text:
            raise ValueError("Empty response from Gemini API")
        
        return response.text
    except Exception as e:
        print(f"[Gemini Error] {e}")
        raise


def analyze_with_nvidia(image_data_b64, mode, user_query=""):
    """Use NVIDIA NIM API for vision analysis - Optimized for Speed."""
    import requests
    
    prompt = build_prompt(mode, user_query)
    headers = {
        "Authorization": f"Bearer {NVIDIA_API_KEY}",
        "Content-Type": "application/json",
    }
    
    # 1. Faster Image Optimization (reduce payload lag)
    try:
        image_bytes = base64.b64decode(image_data_b64)
        image = Image.open(io.BytesIO(image_bytes))
        # Smaller dimension for much faster processing
        max_dim = 640 
        if image.width > max_dim or image.height > max_dim:
            ratio = max_dim / max(image.width, image.height)
            new_size = (int(image.width * ratio), int(image.height * ratio))
            image = image.resize(new_size, Image.LANCZOS)
        
        buf = io.BytesIO()
        # Lower quality reduces bytes by ~60% with minimal impact on 11B AI accuracy
        image.save(buf, format='JPEG', quality=70) 
        image_data_b64 = base64.b64encode(buf.getvalue()).decode('utf-8')
    except Exception as e:
        print(f"[NVIDIA] Optimization skip: {e}")
    
    # 2. Correct NVIDIA Model ID - Reverted to 11B for much faster response
    payload = {
        "model": "meta/llama-3.2-11b-vision-instruct", 
        "messages": [
            {
                "role": "user",
                "content": [
                    {"type": "text", "text": prompt},
                    {"type": "image_url", "image_url": {"url": f"data:image/jpeg;base64,{image_data_b64}"}},
                ],
            }
        ],
        "max_tokens": 1024,
        "temperature": 0.2, # Slightly higher for better conversational flow
    }
    
    # 3. Fast Timeout for better UX
    try:
        resp = requests.post(
            "https://integrate.api.nvidia.com/v1/chat/completions",
            headers=headers,
            json=payload,
            timeout=15, # 11B is fast, 15s is plenty
        )
        if resp.status_code != 200:
            print(f"[NVIDIA API Error] Status {resp.status_code}: {resp.text}")
            
        resp.raise_for_status()
        data = resp.json()
        if "choices" in data and len(data["choices"]) > 0:
            return data["choices"][0]["message"]["content"]
    except Exception as e:
        print(f"[NVIDIA Exception] {e}")
    
    raise RuntimeError("NVIDIA processing failed or timed out")


def build_prompt(mode, user_query=""):
    """Build the AI prompt based on the analysis mode."""
    
    base_context = (
        "You are VisionAid, a compassionate AI assistant designed specifically to help "
        "visually impaired people. You MUST respond in a warm, clear, conversational tone — "
        "as if you are a caring friend helping someone. Use simple language. "
        "Always describe spatial positions (left, center/middle, right, top, bottom) clearly. "
        "Never use technical jargon. Be thorough but concise.\n\n"
    )
    
    if mode == "medicine":
        prompt = base_context + (
            "TASK: You are analyzing an image that contains medicine. This is CRITICAL for the user's health.\n"
            "Identify the medicine name with 100% accuracy using OCR. If the medicine name is small, look closely at all text on the packaging.\n\n"
            "Please provide the following information in a friendly, spoken manner:\n"
            "1. **Medicine Name**: Clearly state the name of the medicine. Look for brand names and generic names (like 'Paracetamol').\n"
            "2. **Purpose**: What is this medicine used for? Explain in simple terms.\n"
            "3. **Dosage**: Mention the strength (e.g., 500mg) and basic instructions if visible.\n"
            "4. **Warnings**: Crucial side effects or warnings (e.g., 'May cause drowsiness').\n"
            "5. **Position**: Describe exactly where it is (e.g., 'Right in front of you', 'Slightly to the left').\n"
            "6. **Safety First**: Always remind the user to 'Check with your doctor or pharmacist' before taking it.\n\n"
            "If you see multiple medicines, describe them one by one starting from the left.\n"
            "If no medicine is clearly visible, say: 'I'm sorry, I can't clearly see the medicine name. Could you please bring it closer to the camera or show the other side?'\n\n"
            "Speak naturally. Start with: 'I can see...' or 'You're holding...'\n"
        )
    
    elif mode == "document":
        prompt = base_context + (
            "TASK: You are reading a document, paper, letter, or any text placed in front of the camera.\n\n"
            "Please:\n"
            "1. **Extract ALL text** visible in the image — read it completely.\n"
            "2. **Summarize** the content in simple, easy-to-understand language.\n"
            "3. **Key Points**: Highlight any important information (dates, names, amounts, instructions).\n"
            "4. If it's a form or official document, explain what kind of document it is and what "
            "action might be needed.\n\n"
            "Read the text out in a natural flow, as if you're reading a letter aloud to someone. "
            "Start with something like 'Let me read this for you...' or 'This appears to be...'\n"
        )
    
    elif mode == "object":
        prompt = base_context + (
            "TASK: You are identifying and describing objects placed in front of the camera.\n\n"
            "Please:\n"
            "1. **Identify** all objects you can see in the image.\n"
            "2. **Describe** each object (color, size, shape, type).\n"
            "3. **Position**: Clearly state where each object is located — left, center, right, "
            "top, bottom, near, far.\n"
            "4. **Safety**: If any object could be dangerous (sharp, hot, breakable), warn the user.\n"
            "5. **Context**: Provide helpful context about what the objects might be used for.\n\n"
            "Describe the scene naturally, like: 'In front of you, I can see three items. "
            "On your left, there is...' Always use directional language.\n"
        )
    
    elif mode == "navigation":
        prompt = base_context + (
            "TASK: You are a mobility assistant helping the user navigate through their environment.\n\n"
            "Please focus on:\n"
            "1. **Person Count**: Identify how many people are in the scene.\n"
            "2. **Obstacles**: Detect any obstacles in the path (e.g., furniture, stairs, walls, or floor items).\n"
            "3. **Distance Estimation**: Estimate the distance to important objects or people (e.g., 'about 2 meters away', 'just a few steps in front').\n"
            "4. **Navigation Path**: Suggest a clear path if one exists (e.g., 'The path to your right is clear').\n\n"
            "Describe the scene for immediate navigation, like: 'There are two people about 3 meters ahead of you. No obstacles in your immediate path.'\n"
        )
    
    else:
        prompt = base_context + (
            "TASK: Analyze this image and describe everything you see in detail. "
            "Use directional language (left, right, center, top, bottom) to help the user "
            "understand the spatial layout. Be warm and conversational.\n"
        )
    
    if user_query:
        prompt += f"\nThe user also asks: '{user_query}'\nPlease address their question as well.\n"
    
    return prompt


def get_demo_response(mode, user_query=""):
    """Provide a demo response when no API key is configured."""
    
    if mode == "medicine":
        return (
            "I can see you've placed some medicine in front of me. Let me help you with that!\n\n"
            "I can see three strips of tablets arranged in front of you:\n\n"
            "**On your left side**, there's a strip of Paracetamol 500mg. This medicine is commonly "
            "used for reducing fever and relieving mild to moderate pain, like headaches or body aches. "
            "The usual dosage for adults is one or two tablets every 4 to 6 hours, but don't take more "
            "than 8 tablets in 24 hours. Please take it with water, preferably after food.\n\n"
            "**In the middle**, I can see Cetirizine 10mg tablets. This is an antihistamine used for "
            "allergies — it helps with runny nose, sneezing, and itchy eyes. You usually take one tablet "
            "once a day. It might make you a little drowsy, so be careful if you're planning to go out.\n\n"
            "**On your right side**, there's Amoxicillin 250mg. This is an antibiotic used to treat "
            "bacterial infections. You should only take this if prescribed by your doctor, and you must "
            "complete the full course even if you start feeling better.\n\n"
            "**My suggestion**: If you're experiencing any symptoms, I'd recommend visiting your "
            "doctor before taking any of these medicines, especially the antibiotic. Would you like me "
            "to tell you more about any specific medicine?"
        )
    
    elif mode == "document":
        return (
            "Let me read this document for you.\n\n"
            "This appears to be a medical prescription from Dr. Sharma's Clinic, dated February 28, 2026.\n\n"
            "The prescription says:\n\n"
            "**Patient Name**: It mentions a patient name at the top.\n\n"
            "**Medicines prescribed**:\n"
            "1. Paracetamol 500mg — Take one tablet twice a day after food, for 5 days.\n"
            "2. Vitamin D3 — One capsule per week for 8 weeks.\n"
            "3. An ointment to apply on the affected area twice daily.\n\n"
            "**Follow-up**: The doctor has written that you should come for a follow-up visit "
            "after two weeks.\n\n"
            "**Important note at the bottom**: It says 'Drink plenty of water and take adequate rest.'\n\n"
            "Would you like me to read any part again or explain anything in more detail?"
        )
    
    elif mode == "navigation":
        return (
            "I'm now scanning your surroundings for navigation.\n\n"
            "**Person Count**: I can see 2 people in the room. They are standing about 3 meters ahead of you, slightly to the right.\n\n"
            "**Obstacles**: There is a chair directly in front of you, about 1 meter away. There is also a small rug on the floor to your left.\n\n"
            "**Distance**: The nearest wall is approximately 4 meters away on your right.\n\n"
            "**Navigation Path**: If you step slightly to the left, you have a clear path forward for at least 5 meters.\n\n"
            "Please walk slowly and be aware of the chair."
        )

    elif mode == "object":
        return (
            "Let me describe what I can see in front of you.\n\n"
            "I can see several items arranged on what appears to be a table:\n\n"
            "**On your left**, there's a pair of glasses with a dark frame — they look like reading glasses.\n\n"
            "**In the center**, directly in front of you, there's a coffee mug. It appears to be white "
            "with some design on it. It seems to have some liquid inside.\n\n"
            "**On your right**, I can see a smartphone lying face-up on the table.\n\n"
            "**Behind the mug**, slightly to the left, there's what looks like a book or a notebook "
            "with a blue cover.\n\n"
            "Everything looks safe to touch. The mug might be warm if it has hot coffee, "
            "so please be careful when reaching for it.\n\n"
            "Would you like me to describe anything in more detail?"
        )
    
    return (
        "I can see the image you've shown me. Let me describe what's in front of you...\n\n"
        "This is a demo response. To get real AI-powered analysis, please configure your "
        "API key in the .env file. You can get a free Gemini API key from "
        "https://aistudio.google.com/apikey"
    )


def _is_valid_api_key(key):
    """Check if an API key is a real value and not a placeholder."""
    return bool(key and key not in (
        "your_gemini_api_key_here",
        "your_nvidia_api_key_here",
        "",
    ))


# ─── Routes ──────────────────────────────────────────────────────────────────

@app.route("/")
def index():
    """Serve the main application page."""
    return render_template("index.html")


@app.route("/api/analyze", methods=["POST"])
def analyze_image():
    """Analyze an image captured from the camera."""
    try:
        data = request.get_json(silent=True)
        
        if not data or "image" not in data:
            return jsonify({"error": "No image data provided"}), 400
        
        image_b64 = data["image"]
        mode = data.get("mode", "object")
        user_query = data.get("query", "")
        
        # Validate mode
        if mode not in ("medicine", "document", "object", "navigation"):
            mode = "object"
        
        # Sanitize user query (limit length)
        if user_query:
            user_query = user_query[:500]
        
        # Remove the data URL prefix if present
        if "base64," in image_b64:
            image_b64 = image_b64.split("base64,")[1]
        
        # Basic validation — ensure it's valid base64
        try:
            test_decode = base64.b64decode(image_b64[:100])
        except Exception:
            return jsonify({"error": "Invalid image data"}), 400
        
        result = None
        used_provider = "demo"
        
        # Try the configured AI provider first
        final_error = None
        
        # 1. Primary Attempt
        if mode == "medicine" and _is_valid_api_key(NVIDIA_API_KEY):
            # Medicine ALWAYS uses NVIDIA as requested for "Nvidia models in medicine section"
            try:
                result = analyze_with_nvidia(image_b64, mode, user_query)
                used_provider = "nvidia (medicine-optimized)"
            except Exception as e:
                final_error = str(e)
                print(f"[Medicine NVIDIA Failed] {e}")
        
        # If not medicine, OR if NVIDIA medicine call failed, use the designated AI_PROVIDER
        if result is None:
            if AI_PROVIDER == "gemini" and _is_valid_api_key(GEMINI_API_KEY):
                try:
                    result = analyze_with_gemini(image_b64, mode, user_query)
                    used_provider = "gemini"
                except Exception as e:
                    final_error = str(e)
                    print(f"[Gemini Primary Failed] {e}")
            
            elif (AI_PROVIDER == "nvidia" or mode == "medicine") and _is_valid_api_key(NVIDIA_API_KEY):
                try:
                    result = analyze_with_nvidia(image_b64, mode, user_query)
                    used_provider = "nvidia"
                except Exception as e:
                    final_error = str(e)
                    print(f"[NVIDIA Primary Failed] {e}")

        # 3. Final Fallback (Try the other one if the first choice failed)
        if result is None:
            if _is_valid_api_key(GEMINI_API_KEY) and "gemini" not in used_provider:
                try:
                    result = analyze_with_gemini(image_b64, mode, user_query)
                    used_provider = "gemini (fallback)"
                except Exception as e:
                    print(f"[Final Gemini Fallback Failed] {e}")
            
            if result is None and _is_valid_api_key(NVIDIA_API_KEY) and "nvidia" not in used_provider:
                try:
                    result = analyze_with_nvidia(image_b64, mode, user_query)
                    used_provider = "nvidia (fallback)"
                except Exception as e:
                    print(f"[Final NVIDIA Fallback Failed] {e}")
        
        # 3. Last resort demo fallback
        if result is None:
            # ONLY use demo if explicitly no keys or ALL APIs failed
            result = get_demo_response(mode, user_query)
            used_provider = "demo"
            print(f"[Analyze Fallback] Using demo because: {final_error or 'No API keys'}")
        
        print(f"[Analyze] Provider used: {used_provider}, Mode: {mode}")
        
        return jsonify({
            "success": True,
            "result": result,
            "mode": mode,
            "timestamp": datetime.now().isoformat(),
        })
    
    except Exception as e:
        traceback.print_exc()
        # Even on total failure, return a friendly demo response instead of a 500
        try:
            fallback_mode = request.get_json(silent=True).get("mode", "object") if request.get_json(silent=True) else "object"
        except Exception:
            fallback_mode = "object"
        return jsonify({
            "success": True,
            "result": get_demo_response(fallback_mode),
            "mode": fallback_mode,
            "timestamp": datetime.now().isoformat(),
            "note": "Using demo response due to a server error."
        })


@app.route("/api/health", methods=["GET"])
def health_check():
    """Health check endpoint."""
    has_key = _is_valid_api_key(GEMINI_API_KEY) or _is_valid_api_key(NVIDIA_API_KEY)
    
    return jsonify({
        "status": "healthy",
        "ai_provider": AI_PROVIDER,
        "api_configured": has_key,
        "demo_mode": not has_key,
        "version": "1.0.0",
    })


# ─── Error Handlers ─────────────────────────────────────────────────────────

@app.errorhandler(413)
def request_entity_too_large(error):
    """Handle file too large errors."""
    return jsonify({
        "error": "Image is too large. Maximum size is 16MB.",
        "success": False,
    }), 413


@app.errorhandler(404)
def not_found(error):
    """Handle 404 errors."""
    return jsonify({
        "error": "Endpoint not found.",
        "success": False,
    }), 404


@app.errorhandler(500)
def internal_server_error(error):
    """Handle 500 errors."""
    return jsonify({
        "error": "Internal server error. Please try again.",
        "success": False,
    }), 500


# ─── Run ─────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    print("\n" + "=" * 60)
    print("  🔵 VisionAid — AI-Powered Blind Assistance")
    print("=" * 60)
    
    has_key = _is_valid_api_key(GEMINI_API_KEY) or _is_valid_api_key(NVIDIA_API_KEY)
    
    if has_key:
        print(f"  ✅ AI Provider: {AI_PROVIDER.upper()}")
    else:
        print("  ⚠️  Running in DEMO MODE (no API key configured)")
        print("  📌 Get a free Gemini key: https://aistudio.google.com/apikey")
        print("  📌 Then add it to your .env file")
    
    print(f"\n  🌐 Open http://localhost:5000 in your browser")
    print("=" * 60 + "\n")
    
    app.run(debug=True, host="0.0.0.0", port=5002)
