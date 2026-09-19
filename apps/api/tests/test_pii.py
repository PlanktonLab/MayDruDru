"""個資處理（SPEC §11）：加密可逆、hash 不可逆、遮蔽不洩漏。"""

import pytest
from app import pii


def test_phone_round_trips_through_encryption():
    token = pii.encrypt_phone("0912345678")
    assert token != "0912345678"
    assert "0912" not in token
    assert pii.decrypt_phone(token) == "0912345678"


def test_encrypting_the_same_number_twice_gives_different_ciphertext():
    """Fernet 帶 nonce；否則密文本身就變成一個可比對的指紋。"""
    assert pii.encrypt_phone("0912345678") != pii.encrypt_phone("0912345678")


def test_empty_phone_stays_empty():
    assert pii.encrypt_phone("") == ""
    assert pii.decrypt_phone("") == ""


def test_undecryptable_token_returns_empty_instead_of_raising():
    """輪替金鑰之後的舊資料不該讓整支推播炸掉。"""
    assert pii.decrypt_phone("not-a-fernet-token") == ""


@pytest.mark.parametrize("value", ["0912345678", "0912-345-678", "+886912345678", "0912 345 678", "5678"])
def test_last4_normalises_every_common_phone_spelling(value):
    assert pii.last4(value) == "5678"


def test_hash_last4_matches_across_spellings_and_hides_the_digits():
    h = pii.hash_last4("0912345678")
    assert h == pii.hash_last4("0912-345-678") == pii.hash_last4("5678")
    assert "5678" not in h
    assert len(h) == 64


def test_hash_last4_separates_different_numbers():
    assert pii.hash_last4("0912345678") != pii.hash_last4("0912345679")


def test_hash_last4_refuses_a_value_shorter_than_four():
    assert pii.hash_last4("678") == ""
    assert pii.hash_last4("") == ""


def test_id_numbers_are_normalised_case_insensitively():
    assert pii.last4("A12345678x") == "678X"
    assert pii.hash_last4("A12345678x") == pii.hash_last4("678X")


@pytest.mark.parametrize("name,masked", [
    ("測試用小明", "測OOO明"),
    ("王小明", "王O明"),
    ("王明", "王O"),
    ("王", "王"),
    ("", ""),
])
def test_mask_name(name, masked):
    assert pii.mask_name(name) == masked


@pytest.mark.parametrize("phone,masked", [
    ("0912345678", "******5678"),
    ("0912-345-678", "******5678"),
    ("5678", "5678"),
    ("", ""),
])
def test_mask_phone_keeps_only_the_last_four(phone, masked):
    assert pii.mask_phone(phone) == masked
