const myImage = document.querySelector("img");

myImage.addEventListener("click", () => {
  const mySrc = myImage.getAttribute("src");
  if (mySrc === "images/seol_hwa.png") {
    myImage.setAttribute("src", "images/seol_hwa2.png");
  } else {
    myImage.setAttribute("src", "images/seol_hwa.png");
  }
});
let myButton = document.querySelector("button");
let myHeading = document.querySelector("h1");
function setUserName() {
  const myName = prompt("Please enter your name.");
  if (!myName) {
    setUserName();
  } else {
    localStorage.setItem("name", myName);
    myHeading.textContent = `Seol Hwa is cool, ${myName}`;
  }
}
if (!localStorage.getItem("name")) {
  setUserName();
} else {
  const storedName = localStorage.getItem("name");
  myHeading.textContent = `Seol Hwa is cool, ${storedName}`;
}
myButton.addEventListener("click", () => {
  setUserName();
});