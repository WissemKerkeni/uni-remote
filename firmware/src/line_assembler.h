// Reassembles newline-delimited messages from arbitrary chunks (BLE writes or
// serial bytes). Messages larger than maxLen are discarded up to the next '\n'.
#pragma once

#include <stddef.h>
#include <string>

class LineAssembler {
 public:
  enum class Result { None, Line, Overflow };

  explicit LineAssembler(size_t maxLen) : max_(maxLen) {}

  Result push(char c, std::string& out) {
    if (c == '\n') {
      if (discarding_) {
        discarding_ = false;
        buf_.clear();
        return Result::None;
      }
      if (buf_.empty()) return Result::None;
      out.swap(buf_);
      buf_.clear();
      return Result::Line;
    }
    if (c == '\r' || discarding_) return Result::None;
    if (buf_.size() >= max_) {
      discarding_ = true;
      buf_.clear();
      return Result::Overflow;
    }
    buf_.push_back(c);
    return Result::None;
  }

  void reset() {
    buf_.clear();
    discarding_ = false;
  }

 private:
  std::string buf_;
  size_t max_;
  bool discarding_ = false;
};
