import cv2
import time

def test_camera():
    print("Testing Camera indices...")
    for i in range(3):
        print(f"Trying Index {i}...")
        cap = cv2.VideoCapture(i)
        if cap.isOpened():
            ret, frame = cap.read()
            if ret:
                print(f"WIN: Camera found at index {i}!")
                cap.release()
                return i
            cap.release()
    print("LOSE: No working camera found.")
    return None

if __name__ == "__main__":
    index = test_camera()
    if index is not None:
        with open("cam_index.txt", "w") as f:
            f.write(str(index))
