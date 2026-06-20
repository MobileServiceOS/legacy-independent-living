/* Legacy Independent Living — progressive enhancement only.
   The site is fully usable with JavaScript disabled. */
(function () {
  "use strict";

  /* ---------- Mobile nav ---------- */
  var toggle = document.querySelector(".nav-toggle");
  var nav = document.getElementById("primary-nav");
  if (toggle && nav) {
    toggle.addEventListener("click", function () {
      var open = toggle.getAttribute("aria-expanded") === "true";
      toggle.setAttribute("aria-expanded", String(!open));
      nav.classList.toggle("is-open", !open);
    });
    // Close the menu after following an in-page link
    nav.addEventListener("click", function (e) {
      if (e.target.closest("a")) {
        toggle.setAttribute("aria-expanded", "false");
        nav.classList.remove("is-open");
      }
    });
  }

  /* ---------- FAQ accordion ---------- */
  var questions = document.querySelectorAll(".faq__q");
  questions.forEach(function (q) {
    var panel = document.getElementById(q.getAttribute("aria-controls"));
    if (!panel) return;
    q.addEventListener("click", function () {
      var open = q.getAttribute("aria-expanded") === "true";
      q.setAttribute("aria-expanded", String(!open));
      panel.style.maxHeight = open ? null : panel.scrollHeight + "px";
    });
  });
  // Keep an open panel sized correctly on resize
  window.addEventListener("resize", function () {
    document.querySelectorAll('.faq__q[aria-expanded="true"]').forEach(function (q) {
      var panel = document.getElementById(q.getAttribute("aria-controls"));
      if (panel) panel.style.maxHeight = panel.scrollHeight + "px";
    });
  });

  /* ---------- Inquiry form -> mailto (no backend) ---------- */
  var form = document.getElementById("inquiry-form");
  if (form) {
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var to = form.getAttribute("data-email") || "";
      var get = function (n) {
        var el = form.elements[n];
        return el ? String(el.value || "").trim() : "";
      };
      var name = get("name");
      var phone = get("phone");
      var email = get("email");
      var reason = get("reason");
      var message = get("message");

      var subject = "Inquiry from " + (name || "the website") + " — Legacy Independent Living";
      var bodyLines = [
        "Name: " + name,
        "Phone: " + phone,
        "Email: " + email,
        "Reason for inquiry: " + reason,
        "",
        "Message:",
        message,
        "",
        "— Sent from legacyindependentliving.net"
      ];
      var href =
        "mailto:" + encodeURIComponent(to) +
        "?subject=" + encodeURIComponent(subject) +
        "&body=" + encodeURIComponent(bodyLines.join("\r\n"));

      var status = document.getElementById("form-status");
      if (status) {
        status.textContent =
          "Opening your email app to send this to our team. If nothing happens, email us directly at " + to + ".";
      }
      window.location.href = href;
    });
  }
})();
