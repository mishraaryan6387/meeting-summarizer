from flask import Flask, request, jsonify, send_from_directory
from transformers import pipeline

app = Flask(__name__, static_url_path='', static_folder='.')

summarizer = pipeline("summarization", model="facebook/bart-large-cnn")

@app.route("/")
def index():
    return send_from_directory('.', 'index.html')

@app.route("/summarize", methods=["POST"])
def summarize():
    data = request.get_json()
    text = data.get("text", "")

    if not text.strip():
        return jsonify({"paragraph": "No text provided", "bullets": []})

    paragraph_summary = summarizer(text, max_length=100, min_length=30, do_sample=False)[0]['summary_text']

    bullet_points = [sentence.strip() for sentence in paragraph_summary.split('.') if sentence.strip()]

    return jsonify({
        "paragraph": paragraph_summary,
        "bullets": bullet_points
    })

if __name__ == "__main__":
    app.run(debug=True)
