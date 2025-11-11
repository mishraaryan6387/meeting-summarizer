document.getElementById("summarizeBtn").addEventListener("click", async () => {
  const inputText = document.getElementById("inputText").value.trim();
  const fileInput = document.getElementById("fileInput").files[0];
  let textToSummarize = inputText;

  if (fileInput) {
    const fileText = await fileInput.text();
    textToSummarize += "\n" + fileText;
  }

  if (!textToSummarize) {
    alert("Please enter or upload some text first!");
    return;
  }

  const btn = document.getElementById("summarizeBtn");
  btn.innerText = "⏳ Summarizing...";
  btn.disabled = true;

  try {
    const response = await fetch("/summarize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: textToSummarize }),
    });

    const data = await response.json();

    document.getElementById("summaryOutput").style.display = "block";
    document.getElementById("paragraphSummary").innerText = data.paragraph;
    document.getElementById("bulletSummary").innerHTML =
      data.bullets.map(point => `<li>${point}</li>`).join("");
  } catch (error) {
    alert("❌ Something went wrong. Please try again.");
  }

  btn.innerText = "✨ Summarize Notes";
  btn.disabled = false;
});
