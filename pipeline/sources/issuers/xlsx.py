import io
import xml.etree.ElementTree as ET
import zipfile


def _local(tag):
    return tag.rsplit("}", 1)[-1]


def xlsx_rows(data):
    """First sheet of an .xlsx file (bytes) as a list of {column letter: text} dicts, one per row (standard library only;
    no openpyxl in requirements). Handles shared strings and inline strings, with or without an XML namespace prefix."""
    book = zipfile.ZipFile(io.BytesIO(data))
    strings = []
    if "xl/sharedStrings.xml" in book.namelist():
        strings = ["".join(t.text or "" for t in si.iter() if _local(t.tag) == "t") for si in ET.fromstring(book.read("xl/sharedStrings.xml"))]
    rows = []
    for row in (el for el in ET.fromstring(book.read("xl/worksheets/sheet1.xml")).iter() if _local(el.tag) == "row"):
        cells = {}
        for cell in row:
            value = next((v for v in cell if _local(v.tag) == "v"), None)
            if cell.get("t") == "s" and value is not None:
                text = strings[int(value.text)]
            elif cell.get("t") == "inlineStr":
                text = "".join(t.text or "" for t in cell.iter() if _local(t.tag) == "t")
            else:
                text = value.text if value is not None else None
            cells["".join(ch for ch in cell.get("r") if ch.isalpha())] = text
        rows.append(cells)
    return rows
