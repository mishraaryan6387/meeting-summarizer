// script.js — upload with animated progress (XMLHttpRequest)
(() => {
  const input = document.getElementById("fileInput");
  const drop = document.getElementById("fileDrop");
  const uploadBtn = document.getElementById("uploadBtn");
  const status = document.getElementById("status");
  const progressWrap = document.getElementById("progressWrap");
  const progressBar = document.getElementById("progressBar");
  const summaryText = document.getElementById("summaryText");
  const bulletsList = document.getElementById("bullets");

  let selectedFile = null;

  function updateUIForFile() {
    if (!selectedFile) {
      uploadBtn.disabled = true;
      status.textContent = "No file selected";
    } else {
      uploadBtn.disabled = false;
      status.textContent = `Selected: ${selectedFile.name} (${Math.round(selectedFile.size/1024)} KB)`;
    }
  }

  // File chooser
  input.addEventListener("change", (e) => {
    selectedFile = e.target.files[0] || null;
    updateUIForFile();
  });

  // Drag & drop support
  ["dragenter","dragover"].forEach(ev => {
    drop.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      drop.classList.add("dragover");
    });
  });
  ["dragleave","drop"].forEach(ev => {
    drop.addEventListener(ev, (e) => {
      e.preventDefault(); e.stopPropagation();
      drop.classList.remove("dragover");
    });
  });
  drop.addEventListener("drop", (e) => {
    const f = e.dataTransfer.files && e.dataTransfer.files[0];
    if (f) {
      selectedFile = f;
      input.files = e.dataTransfer.files; // sync input
      updateUIForFile();
    }
  });

  // Upload logic with progress bar
  uploadBtn.addEventListener("click", () => {
    if (!selectedFile) return alert("Please pick a file first");
    // reset UI
    summaryText.textContent = "Uploading...";
    bulletsList.innerHTML = "";
    progressBar.style.width = "0%";
    progressWrap.classList.remove("hidden");
    uploadBtn.disabled = true;

    const fd = new FormData();
    fd.append("file", selectedFile);

    const xhr = new XMLHttpRequest();
    xhr.open("POST", "/summarize", true);

    // upload progress
    xhr.upload.onprogress = function (e) {
      if (e.lengthComputable) {
        const percent = (e.loaded / e.total) * 100;
        progressBar.style.width = percent.toFixed(1) + "%";
        status.textContent = `Uploading — ${Math.round(percent)}%`;
      } else {
        // show indeterminate animation by toggling width
        progressBar.style.width = "40%";
        status.textContent = "Uploading...";
      }
    };

    xhr.onload = function () {
      uploadBtn.disabled = false;
      try {
        if (xhr.status >= 200 && xhr.status < 300) {
          const data = JSON.parse(xhr.responseText);
          progressBar.style.width = "100%";
          status.textContent = "Upload complete";
          if (data.paragraph) summaryText.textContent = data.paragraph;
          else summaryText.textContent = "No summary returned";
          // bullets array
          bulletsList.innerHTML = "";
          if (Array.isArray(data.bullets)) {
            data.bullets.forEach(b => {
              const li = document.createElement("li");
              li.textContent = b;
              bulletsList.appendChild(li);
            });
          }
        } else {
          summaryText.textContent = `Server error (${xhr.status}): ${xhr.responseText || "no details"}`;
          status.textContent = "Upload failed";
        }
      } catch (err) {
        summaryText.textContent = "Response parse error: " + err.message;
        status.textContent = "Upload failed";
      }
    };

    xhr.onerror = function () {
      uploadBtn.disabled = false;
      status.textContent = "Network error";
      summaryText.textContent = "Network error while uploading.";
    };

    xhr.send(fd);
  });

  // initial state
  updateUIForFile();
})();
